#requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        '01-clean-install',
        '02-shared-existing-config',
        '03-custom-config-filename',
        '04-existing-managed-block',
        '05-known-legacy-standalone',
        '06-modified-legacy-loader-refusal',
        '07-invalid-config-filename',
        '08-comment-and-line-ending-repair'
    )]
    [string]$Scenario,

    [Alias('KeepInstallerArtifacts')]
    [switch]$KeepTestArtifacts,

    [string]$RepositoryRoot,

    [string]$TargetUserSid,

    [string]$TargetUserName,

    [switch]$NoElevation
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$testRoot = Split-Path -Parent $PSCommandPath

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = [IO.Path]::GetFullPath(
        (Join-Path $testRoot '..\..')
    )
} else {
    $RepositoryRoot = $ExecutionContext.SessionState.Path.
        GetUnresolvedProviderPathFromPSPath($RepositoryRoot)
}


function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object `
        -TypeName System.Security.Principal.WindowsPrincipal `
        -ArgumentList $identity

    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Quote-ProcessArgument {
    param([string]$Value)
    if ($null -eq $Value) { return '""' }
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Start-ElevatedCopy {
    if (-not $PSCommandPath) {
        throw 'The scenario runner must be run from a saved .ps1 file in order to elevate.'
    }

    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', (Quote-ProcessArgument $PSCommandPath),
        '-Scenario', (Quote-ProcessArgument $Scenario),
        '-RepositoryRoot', (Quote-ProcessArgument $RepositoryRoot),
        '-TargetUserSid', (Quote-ProcessArgument $TargetUserSid),
        '-TargetUserName', (Quote-ProcessArgument $TargetUserName),
        '-NoElevation'
    )

    if ($KeepTestArtifacts) {
        $arguments += '-KeepTestArtifacts'
    }

    Write-Host 'Requesting administrator privileges for the installer test...' `
        -ForegroundColor Cyan

    try {
        $process = Start-Process `
            -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
            -ArgumentList ($arguments -join ' ') `
            -Verb RunAs `
            -Wait `
            -PassThru

        exit $process.ExitCode
    } catch {
        if ($_.Exception.NativeErrorCode -eq 1223) {
            Write-Host 'Administrator elevation was cancelled.' -ForegroundColor Yellow
            exit 1223
        }
        throw
    }
}

$launchIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $TargetUserSid) { $TargetUserSid = $launchIdentity.User.Value }
if (-not $TargetUserName) { $TargetUserName = $launchIdentity.Name }

if (-not (Test-IsAdministrator)) {
    if ($NoElevation) {
        throw 'Administrator privileges are required to run this installer test.'
    }
    Start-ElevatedCopy
}

function Assert-Test {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Get-FileHashValue {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-StringSha256Prefix {
    param([string]$Value, [int]$Length = 12)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        $hash = $sha.ComputeHash($bytes)
    } finally {
        $sha.Dispose()
    }
    $hex = ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    return $hex.Substring(0, $Length)
}


function Resolve-StagedFixturePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,

        [Parameter(Mandatory = $true)]
        [string]$WorkRoot,

        [Parameter(Mandatory = $true)]
        [string]$FirefoxPath,

        [Parameter(Mandatory = $true)]
        [string]$ProfilePath
    )

    $normalized = $RelativePath.Replace('/', '\')

    if ($normalized -like 'firefox-installation\*') {
        $childPath = $normalized.Substring(
            'firefox-installation\'.Length
        )
        return Join-Path $FirefoxPath $childPath
    }

    if ($normalized -like 'profile\*') {
        $childPath = $normalized.Substring('profile\'.Length)
        return Join-Path $ProfilePath $childPath
    }

    return Join-Path $WorkRoot $normalized
}


function Remove-DirectoryIfEmpty {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return
    }

    $firstChild = Get-ChildItem -LiteralPath $Path -Force |
        Select-Object -First 1

    if ($null -eq $firstChild) {
        Remove-Item -LiteralPath $Path -Force
    }
}

function Remove-TestArtifacts {
    param(
        [string]$WorkRoot,
        [string]$ProtectedProfile,
        [string]$BackupRoot,
        [string[]]$BackupsBefore,
        [switch]$Keep
    )

    if ($Keep) {
        Write-Host 'Test artifacts were retained for inspection:' `
            -ForegroundColor Yellow
        Write-Host "  Work: $WorkRoot"
        Write-Host "  Protected profile: $ProtectedProfile"
        Write-Host "  Backup root: $BackupRoot"
        return
    }

    $warnings = New-Object System.Collections.Generic.List[string]

    if ($ProtectedProfile -and (Test-Path -LiteralPath $ProtectedProfile)) {
        try {
            Remove-Item -LiteralPath $ProtectedProfile -Recurse -Force
        } catch {
            $warnings.Add(
                "Could not remove protected test profile '$ProtectedProfile': " +
                $_.Exception.Message
            )
        }
    }

    if (Test-Path -LiteralPath $BackupRoot -PathType Container) {
        try {
            $newBackups = @(
                Get-ChildItem -LiteralPath $BackupRoot -Directory |
                    Where-Object { $BackupsBefore -notcontains $_.FullName }
            )

            foreach ($backup in $newBackups) {
                try {
                    Remove-Item -LiteralPath $backup.FullName -Recurse -Force
                } catch {
                    $warnings.Add(
                        "Could not remove test backup '$($backup.FullName)': " +
                        $_.Exception.Message
                    )
                }
            }
        } catch {
            $warnings.Add(
                "Could not enumerate test backups under '$BackupRoot': " +
                $_.Exception.Message
            )
        }
    }

    if (Test-Path -LiteralPath $WorkRoot) {
        try {
            Remove-Item -LiteralPath $WorkRoot -Recurse -Force
        } catch {
            $warnings.Add(
                "Could not remove staged work directory '$WorkRoot': " +
                $_.Exception.Message
            )
        }
    }

    $programDataRoot = Join-Path $env:ProgramData 'ExtensionSwitchboard'
    foreach ($path in @(
        (Join-Path $programDataRoot 'Profiles'),
        (Join-Path $programDataRoot 'Backups'),
        $programDataRoot
    )) {
        try {
            Remove-DirectoryIfEmpty -Path $path
        } catch {
            $warnings.Add(
                "Could not remove empty directory '$path': " +
                $_.Exception.Message
            )
        }
    }

    if ($warnings.Count) {
        Write-Host 'Test cleanup completed with warnings:' -ForegroundColor Yellow
        foreach ($warning in $warnings) {
            Write-Host "  - $warning" -ForegroundColor Yellow
        }
    } else {
        Write-Host 'Temporary test artifacts were removed.' `
            -ForegroundColor DarkGray
    }
}

$fixtureRoot = Join-Path $testRoot "fixtures\$Scenario"
$manifestPath = Join-Path $fixtureRoot 'scenario.json'
$workRoot = Join-Path $testRoot "Work\$Scenario"
$firefoxPath = Join-Path $workRoot 'Firefox'
$profilePath = Join-Path $workRoot 'Profile'
$transcriptPath = Join-Path $workRoot 'installer-output.txt'
$backupRoot = Join-Path $env:ProgramData 'ExtensionSwitchboard\Backups'

$installer = Join-Path `
    $RepositoryRoot `
    'installer\windows\Install-ExtensionSwitchboard.ps1'
$source = Join-Path `
    $RepositoryRoot `
    'src\ExtensionSwitchboard.uc.js'

if (-not (Test-Path -LiteralPath $RepositoryRoot -PathType Container)) {
    throw "Repository root does not exist: $RepositoryRoot"
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Scenario manifest does not exist: $manifestPath"
}
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Canonical installer does not exist: $installer"
}
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Canonical source script does not exist: $source"
}

$backupsBefore = @()
if (Test-Path -LiteralPath $backupRoot -PathType Container) {
    $backupsBefore = @(
        Get-ChildItem -LiteralPath $backupRoot -Directory |
            ForEach-Object FullName
    )
}

$safeLeaf = (Split-Path $profilePath -Leaf) -replace '[^A-Za-z0-9._-]', '_'
$profileHash = Get-StringSha256Prefix `
    -Value ([IO.Path]::GetFullPath($profilePath).ToLowerInvariant())
$protectedProfile = Join-Path `
    $env:ProgramData `
    "ExtensionSwitchboard\Profiles\$safeLeaf-$profileHash"

try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw |
        ConvertFrom-Json

    if (Test-Path -LiteralPath $workRoot) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }

    New-Item -ItemType Directory -Path $firefoxPath -Force | Out-Null
    New-Item -ItemType Directory -Path $profilePath -Force | Out-Null

    $seedFirefox = Join-Path $fixtureRoot 'firefox-installation'
    $seedProfile = Join-Path $fixtureRoot 'profile'

    if (Test-Path -LiteralPath $seedFirefox) {
        Copy-Item `
            -Path (Join-Path $seedFirefox '*') `
            -Destination $firefoxPath `
            -Recurse `
            -Force
    }

    if (Test-Path -LiteralPath $seedProfile) {
        Copy-Item `
            -Path (Join-Path $seedProfile '*') `
            -Destination $profilePath `
            -Recurse `
            -Force
    }

    # Resolve-FirefoxInstallPath only requires a file named firefox.exe.
    [IO.File]::WriteAllBytes(
        (Join-Path $firefoxPath 'firefox.exe'),
        [byte[]]@()
    )

    $unchangedFiles = if (
        $manifest.PSObject.Properties.Name -contains 'unchangedFiles'
    ) {
        @($manifest.unchangedFiles)
    } else {
        @()
    }

    $beforeHashes = @{}
    foreach ($relative in $unchangedFiles) {
        $path = Resolve-StagedFixturePath `
            -RelativePath ([string]$relative) `
            -WorkRoot $workRoot `
            -FirefoxPath $firefoxPath `
            -ProfilePath $profilePath
        Assert-Test `
            (Test-Path -LiteralPath $path -PathType Leaf) `
            "Seed file exists: $relative"
        $beforeHashes[$relative] = Get-FileHashValue $path
    }

    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $installer,
        '-Action', 'Install',
        '-ProfilePath', $profilePath,
        '-FirefoxInstallPath', $firefoxPath,
        '-SourceScript', $source,
        '-TargetUserSid', $TargetUserSid,
        '-TargetUserName', $TargetUserName,
        '-NoElevation'
    )

    Write-Host "`nRunning scenario: $Scenario" -ForegroundColor Cyan

    $output = & `
        "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
        @arguments 2>&1
    $exitCode = $LASTEXITCODE

    $output | ForEach-Object { Write-Host $_ }
    $output | Set-Content -LiteralPath $transcriptPath -Encoding UTF8

    Assert-Test `
        ($exitCode -eq [int]$manifest.expectedExitCode) `
        "Installer exit code is $($manifest.expectedExitCode)"

    $outputText = $output -join "`n"
    if ($manifest.PSObject.Properties.Name -contains 'expectedError') {
        Assert-Test `
            ($outputText -match [Regex]::Escape(
                [string]$manifest.expectedError
            )) `
            'Expected error was reported'
    }

    foreach ($relative in $unchangedFiles) {
        $path = Resolve-StagedFixturePath `
            -RelativePath ([string]$relative) `
            -WorkRoot $workRoot `
            -FirefoxPath $firefoxPath `
            -ProfilePath $profilePath
        Assert-Test `
            (Test-Path -LiteralPath $path -PathType Leaf) `
            "Unchanged file still exists: $relative"
        Assert-Test `
            ((Get-FileHashValue $path) -eq $beforeHashes[$relative]) `
            "File remained byte-for-byte unchanged: $relative"
    }

    if ([int]$manifest.expectedExitCode -eq 0) {
        $autoConfigPath = Join-Path `
            $firefoxPath `
            'defaults\pref\autoconfig.js'
        $configPath = Join-Path `
            $firefoxPath `
            ([string]$manifest.configFile)

        Assert-Test `
            (Test-Path -LiteralPath $autoConfigPath -PathType Leaf) `
            'autoconfig.js exists'
        Assert-Test `
            (Test-Path -LiteralPath $configPath -PathType Leaf) `
            "$($manifest.configFile) exists"

        $autoText = [IO.File]::ReadAllText($autoConfigPath)
        $configText = [IO.File]::ReadAllText($configPath)

        Assert-Test `
            ($autoText -match 'pref\("general\.config\.filename",\s*"') `
            'general.config.filename is present'
        Assert-Test `
            ($autoText -match 'pref\("general\.config\.obscure_value",\s*0\);') `
            'obscure_value is set to 0'
        Assert-Test `
            ($autoText -match 'pref\("general\.config\.sandbox_enabled",\s*false\);') `
            'AutoConfig sandbox is disabled'
        Assert-Test `
            ($configText -match [Regex]::Escape(
                '// BEGIN EXTENSION SWITCHBOARD MANAGED LOADER'
            )) `
            'Managed loader block exists'
        Assert-Test `
            ($configText -match [Regex]::Escape(
                '// END EXTENSION SWITCHBOARD MANAGED LOADER'
            )) `
            'Managed loader end marker exists'

        $profileLiteral = ConvertTo-Json `
            -InputObject $profilePath `
            -Compress
        Assert-Test `
            ($configText.Contains($profileLiteral)) `
            'Loader references the staged profile'

        $expectedProtectedScript = Join-Path `
            $protectedProfile `
            'ExtensionSwitchboard.uc.js'
        $protectedScriptLiteral = ConvertTo-Json `
            -InputObject $expectedProtectedScript `
            -Compress
        Assert-Test `
            ($configText.Contains($protectedScriptLiteral)) `
            'Loader references the protected script using a valid JavaScript string literal'

        foreach ($marker in @($manifest.preserveMarkers)) {
            $combined = $autoText + "`n" + $configText
            Assert-Test `
                ($combined.Contains([string]$marker)) `
                "Preserved marker: $marker"
        }

        foreach ($marker in @($manifest.absentMarkers)) {
            Assert-Test `
                (-not $configText.Contains([string]$marker)) `
                "Removed/replaced marker: $marker"
        }

        if (
            $manifest.PSObject.Properties.Name -contains 'managedBlockCount'
        ) {
            $count = (
                [Regex]::Matches(
                    $configText,
                    [Regex]::Escape(
                        '// BEGIN EXTENSION SWITCHBOARD MANAGED LOADER'
                    )
                )
            ).Count
            Assert-Test `
                ($count -eq [int]$manifest.managedBlockCount) `
                "Managed block count is $($manifest.managedBlockCount)"
        }

        if (
            $manifest.PSObject.Properties.Name -contains
                'legacyProfileScriptRemoved' -and
            $manifest.legacyProfileScriptRemoved
        ) {
            Assert-Test `
                (-not (Test-Path -LiteralPath (
                    Join-Path `
                        $profilePath `
                        'chrome\ExtensionSwitchboard.uc.js'
                ))) `
                'Legacy profile script was removed'
        }

        if (
            $manifest.PSObject.Properties.Name -contains
                'requireLeadingComment' -and
            $manifest.requireLeadingComment
        ) {
            Assert-Test `
                ($autoText.TrimStart().StartsWith('//')) `
                'autoconfig.js begins with a comment'
            Assert-Test `
                ($configText.TrimStart().StartsWith('//')) `
                'config file begins with a comment'
        }

        if (
            $manifest.PSObject.Properties.Name -contains 'requireLfOnly' -and
            $manifest.requireLfOnly
        ) {
            Assert-Test `
                (-not $autoText.Contains("`r")) `
                'autoconfig.js uses LF line endings'
            Assert-Test `
                (-not $configText.Contains("`r")) `
                'config file uses LF line endings'
        }
    }

    Write-Host "`nScenario passed." -ForegroundColor Green

    if ($KeepTestArtifacts) {
        Write-Host 'Inspect staged files at:'
        Write-Host $workRoot
        Write-Host "Transcript: $transcriptPath"
    }
} finally {
    Remove-TestArtifacts `
        -WorkRoot $workRoot `
        -ProtectedProfile $protectedProfile `
        -BackupRoot $backupRoot `
        -BackupsBefore $backupsBefore `
        -Keep:$KeepTestArtifacts
}
