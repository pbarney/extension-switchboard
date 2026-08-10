#requires -Version 5.1

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet('Install', 'Verify', 'Uninstall')]
    [string]$Action = 'Install',

    [string]$ProfilePath,

    [string]$FirefoxInstallPath,

    [string]$SourceScript,

    [string]$TargetUserSid,

    [string]$TargetUserName,

    [switch]$KeepLegacyProfileScript,

    [string]$ElevationHandoffPath,

    [string]$ElevationHandoffSha256,

    [switch]$NoElevation
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$Script:ProductName = 'Extension Switchboard'
$Script:ManagedBegin = '// BEGIN EXTENSION SWITCHBOARD MANAGED LOADER'
$Script:ManagedEnd = '// END EXTENSION SWITCHBOARD MANAGED LOADER'
$Script:LegacyLoaderSha256 = 'b9897c8827d28334cd04ed1b4c94103560ca85b28a69ed91175507b7ab5ab70b'

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Write-WarningMessage {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object -TypeName System.Security.Principal.WindowsPrincipal -ArgumentList $identity
    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

function Quote-ProcessArgument {
    param([string]$Value)

    if ($null -eq $Value) {
        return '""'
    }

    return '"' + $Value.Replace('"', '\"') + '"'
}

function Resolve-FullPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [switch]$AllowMissing
    )

    $expanded = [Environment]::ExpandEnvironmentVariables($Path)

    if (-not [IO.Path]::IsPathRooted($expanded)) {
        $expanded = Join-Path (Get-Location) $expanded
    }

    if ($AllowMissing) {
        return [IO.Path]::GetFullPath($expanded)
    }

    return (Resolve-Path -LiteralPath $expanded).ProviderPath
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha.ComputeHash($stream)
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }

    return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
}

function Get-ByteArraySha256 {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($Bytes)
    } finally {
        $sha.Dispose()
    }

    return ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
}


function Get-ExtensionSwitchboardVersion {
    param([Parameter(Mandatory = $true)][string]$Path)

    $text = Read-AllText -Path $Path
    if (
        $text -notmatch 'Extension Switchboard' -or
        $text -notmatch 'const\s+APP\s*=\s*Object\.freeze'
    ) {
        throw "The source file does not appear to be an Extension Switchboard script: $Path"
    }

    $match = [Regex]::Match($text, 'VERSION\s*:\s*"([^"]+)"')
    if (-not $match.Success) {
        throw "The Extension Switchboard version could not be read from $Path"
    }

    return $match.Groups[1].Value
}

function Get-StringSha256Prefix {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [int]$Length = 12
    )

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        $hash = $sha.ComputeHash($bytes)
    } finally {
        $sha.Dispose()
    }

    $hex = ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    return $hex.Substring(0, [Math]::Min($Length, $hex.Length))
}

function Read-AllText {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [IO.File]::ReadAllText($Path)
}

function Write-Utf8NoBomLf {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $normalized = $Text.Replace("`r`n", "`n").Replace("`r", "`n")
    $encoding = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
    [IO.File]::WriteAllText($Path, $normalized, $encoding)
}

function ConvertTo-JavaScriptString {
    param([Parameter(Mandatory = $true)][string]$Value)
    return ConvertTo-Json -InputObject $Value -Compress
}

function Select-FromList {
    param(
        [Parameter(Mandatory = $true)][object[]]$Items,
        [Parameter(Mandatory = $true)][scriptblock]$Display,
        [Parameter(Mandatory = $true)][string]$Prompt
    )

    if ($Items.Count -eq 0) {
        throw "No candidates were found."
    }

    if ($Items.Count -eq 1) {
        return $Items[0]
    }

    Write-Host ''
    for ($index = 0; $index -lt $Items.Count; $index++) {
        $label = & $Display $Items[$index]
        Write-Host ('  [{0}] {1}' -f ($index + 1), $label)
    }

    while ($true) {
        $answer = Read-Host $Prompt
        $number = 0
        if (
            [int]::TryParse($answer, [ref]$number) -and
            $number -ge 1 -and
            $number -le $Items.Count
        ) {
            return $Items[$number - 1]
        }

        Write-WarningMessage "Enter a number from 1 through $($Items.Count)."
    }
}

function Read-IniSections {
    param([Parameter(Mandatory = $true)][string]$Path)

    $sections = @()
    $current = $null

    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        $trimmed = $line.Trim()

        if (-not $trimmed -or $trimmed.StartsWith(';') -or $trimmed.StartsWith('#')) {
            continue
        }

        if ($trimmed -match '^\[(.+)\]$') {
            $current = [ordered]@{ Section = $Matches[1] }
            $sections += $current
            continue
        }

        if ($null -ne $current -and $trimmed -match '^([^=]+)=(.*)$') {
            $current[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }

    return $sections
}

function Get-FirefoxProfileCandidates {
    $profilesIni = Join-Path $env:APPDATA 'Mozilla\Firefox\profiles.ini'

    if (-not (Test-Path -LiteralPath $profilesIni -PathType Leaf)) {
        throw "Firefox profiles.ini was not found at $profilesIni. Specify -ProfilePath explicitly."
    }

    $profilesRoot = Split-Path -Parent $profilesIni
    $profiles = @()

    foreach ($section in Read-IniSections -Path $profilesIni) {
        if ($section.Section -notlike 'Profile*' -or -not $section.Contains('Path')) {
            continue
        }

        $candidatePath = [string]$section.Path
        $isRelative = $section.Contains('IsRelative') -and
            [string]$section.IsRelative -eq '1'
        if ($isRelative) {
            $candidatePath = Join-Path $profilesRoot $candidatePath
        }

        $candidatePath = [IO.Path]::GetFullPath($candidatePath)
        if (-not (Test-Path -LiteralPath $candidatePath -PathType Container)) {
            continue
        }

        $profiles += [pscustomobject]@{
            Name = if ($section.Contains('Name')) { [string]$section.Name } else { Split-Path $candidatePath -Leaf }
            Path = $candidatePath
            Default = (
                $section.Contains('Default') -and
                [string]$section.Default -eq '1'
            )
        }
    }

    if ($profiles.Count -eq 0) {
        throw "No usable Firefox profiles were found in $profilesIni."
    }

    $defaults = @($profiles | Where-Object { $_.Default })
    if ($defaults.Count -eq 1) {
        return $defaults
    }

    return $profiles
}

function Resolve-TargetProfilePath {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        $resolved = Resolve-FullPath -Path $RequestedPath
        if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
            throw "Firefox profile directory not found: $resolved"
        }
        return $resolved
    }

    $selected = Select-FromList `
        -Items @(Get-FirefoxProfileCandidates) `
        -Display {
            param($item)
            $suffix = if ($item.Default) { ' (default)' } else { '' }
            return "$($item.Name)$suffix - $($item.Path)"
        } `
        -Prompt 'Select the Firefox profile to install for'

    return $selected.Path
}

function Get-FirefoxInstallCandidates {
    $candidates = New-Object -TypeName 'System.Collections.Generic.List[string]'

    $registryPaths = @(
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe',
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe'
    )

    foreach ($registryPath in $registryPaths) {
        try {
            $registryKey = Get-Item -LiteralPath $registryPath -ErrorAction Stop
            $value = $registryKey.GetValue('')
            if ($value) {
                $directory = Split-Path -Parent ([Environment]::ExpandEnvironmentVariables([string]$value))
                if (Test-Path -LiteralPath (Join-Path $directory 'firefox.exe') -PathType Leaf) {
                    $candidates.Add([IO.Path]::GetFullPath($directory)) | Out-Null
                }
            }
        } catch {}
    }

    $knownDirectories = @()
    if ($env:ProgramFiles) {
        $knownDirectories += Join-Path $env:ProgramFiles 'Mozilla Firefox'
    }

    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if ($programFilesX86) {
        $knownDirectories += Join-Path $programFilesX86 'Mozilla Firefox'
    }

    foreach ($directory in $knownDirectories) {
        if (Test-Path -LiteralPath (Join-Path $directory 'firefox.exe') -PathType Leaf) {
            $candidates.Add([IO.Path]::GetFullPath($directory)) | Out-Null
        }
    }

    return @($candidates | Sort-Object -Unique)
}

function Resolve-FirefoxInstallPath {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        $resolved = Resolve-FullPath -Path $RequestedPath
        if (Test-Path -LiteralPath $resolved -PathType Leaf) {
            if ((Split-Path $resolved -Leaf) -ine 'firefox.exe') {
                throw "The supplied Firefox executable is not firefox.exe: $resolved"
            }
            $resolved = Split-Path -Parent $resolved
        }

        if (-not (Test-Path -LiteralPath (Join-Path $resolved 'firefox.exe') -PathType Leaf)) {
            throw "firefox.exe was not found in $resolved"
        }

        return $resolved
    }

    $selected = Select-FromList `
        -Items @(Get-FirefoxInstallCandidates) `
        -Display { param($item) return $item } `
        -Prompt 'Select the Firefox installation directory'

    return [string]$selected
}

function Resolve-SourceScriptPath {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        $resolved = Resolve-FullPath -Path $RequestedPath
        if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Extension Switchboard source script not found: $resolved"
        }
        return $resolved
    }

    $candidateNames = @(
        'ExtensionSwitchboard.uc.js',
        'ExtensionSwitchboard.uc.js.txt',
        'ExtensionSwitchboard-v0.7.0.uc.js',
        'ExtensionSwitchboard-v0.7.0.uc.js.txt'
    )

    foreach ($name in $candidateNames) {
        $candidate = Join-Path $PSScriptRoot $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).ProviderPath
        }
    }

    throw "No Extension Switchboard source script was found beside the installer. Specify -SourceScript."
}

function New-ElevationHandoff {
    param(
        [string]$ResolvedProfilePath,
        [string]$ResolvedFirefoxPath,
        [string]$ResolvedSourceScript,
        [string]$UserSid,
        [string]$UserName
    )

    $sourceBytes = $null
    $sourceSha256 = $null
    $sourceBase64 = $null

    if ($ResolvedSourceScript) {
        $sourceBytes = [IO.File]::ReadAllBytes($ResolvedSourceScript)
        $sourceSha256 = Get-ByteArraySha256 -Bytes $sourceBytes
        $sourceBase64 = [Convert]::ToBase64String($sourceBytes)
    }

    $payload = [ordered]@{
        HandoffVersion = 1
        CreatedAtUtc = [DateTime]::UtcNow.ToString('o')
        Action = $Action
        ProfilePath = $ResolvedProfilePath
        FirefoxInstallPath = $ResolvedFirefoxPath
        TargetUserSid = $UserSid
        TargetUserName = $UserName
        KeepLegacyProfileScript = [bool]$KeepLegacyProfileScript
        SourceScriptSha256 = $sourceSha256
        SourceScriptBase64 = $sourceBase64
    }

    $handoffPath = Join-Path `
        ([IO.Path]::GetTempPath()) `
        ("ExtensionSwitchboard-elevation-{0}.json" -f [Guid]::NewGuid().ToString('N'))

    Write-Utf8NoBomLf `
        -Path $handoffPath `
        -Text (($payload | ConvertTo-Json -Depth 4 -Compress) + "`n")

    return [pscustomobject]@{
        Path = $handoffPath
        Sha256 = Get-Sha256 -Path $handoffPath
    }
}

function Import-ElevationHandoff {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256
    )

    $resolvedPath = Resolve-FullPath -Path $Path
    $actualSha256 = Get-Sha256 -Path $resolvedPath
    if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
        throw 'The elevation handoff file failed its integrity check.'
    }

    try {
        $payload = Read-AllText -Path $resolvedPath | ConvertFrom-Json
    } catch {
        throw 'The elevation handoff file does not contain valid JSON.'
    }

    if ([int]$payload.HandoffVersion -ne 1) {
        throw 'The elevation handoff file uses an unsupported version.'
    }

    if (@('Install', 'Verify', 'Uninstall') -notcontains [string]$payload.Action) {
        throw 'The elevation handoff file contains an invalid action.'
    }

    foreach ($requiredName in @(
        'ProfilePath',
        'FirefoxInstallPath',
        'TargetUserSid',
        'TargetUserName'
    )) {
        $requiredValue = [string]$payload.$requiredName
        if ([string]::IsNullOrWhiteSpace($requiredValue)) {
            throw "The elevation handoff file is missing $requiredName."
        }
    }

    if ([string]$payload.Action -eq 'Install') {
        if (
            -not [string]$payload.SourceScriptBase64 -or
            -not [string]$payload.SourceScriptSha256
        ) {
            throw 'The elevation handoff file is missing the source script.'
        }

        try {
            $sourceBytes = [Convert]::FromBase64String(
                [string]$payload.SourceScriptBase64
            )
        } catch {
            throw 'The elevation handoff source script is not valid Base64 data.'
        }

        $sourceSha256 = Get-ByteArraySha256 -Bytes $sourceBytes
        if ($sourceSha256 -ne ([string]$payload.SourceScriptSha256).ToLowerInvariant()) {
            throw 'The elevation handoff source script failed its integrity check.'
        }
    }

    return $payload
}

function New-StagedSourceFromHandoff {
    param([Parameter(Mandatory = $true)]$Payload)

    $sourceBytes = [Convert]::FromBase64String(
        [string]$Payload.SourceScriptBase64
    )
    $expectedSha256 = ([string]$Payload.SourceScriptSha256).ToLowerInvariant()

    $stagingRoot = Join-Path $env:ProgramData 'ExtensionSwitchboardInstaller'
    $stagingDirectory = Join-Path `
        $stagingRoot `
        ("Staging-{0}" -f [Guid]::NewGuid().ToString('N'))
    $stagedPath = Join-Path $stagingDirectory 'ExtensionSwitchboard.uc.js'

    try {
        New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
        Set-DirectoryAcl -Path $stagingRoot -ReadSids @()
        New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
        Set-DirectoryAcl -Path $stagingDirectory -ReadSids @()

        [IO.File]::WriteAllBytes($stagedPath, $sourceBytes)
        Set-FileAcl -Path $stagedPath -ReadSids @()

        if ((Get-Sha256 -Path $stagedPath) -ne $expectedSha256) {
            throw 'The staged source script failed its integrity check.'
        }

        return [pscustomobject]@{
            Path = $stagedPath
            Directory = $stagingDirectory
        }
    } catch {
        if (Test-Path -LiteralPath $stagingDirectory -PathType Container) {
            Remove-Item `
                -LiteralPath $stagingDirectory `
                -Recurse `
                -Force `
                -ErrorAction SilentlyContinue
        }
        throw
    }
}

function Start-ElevatedCopy {
    param(
        [string]$ResolvedProfilePath,
        [string]$ResolvedFirefoxPath,
        [string]$ResolvedSourceScript,
        [string]$UserSid,
        [string]$UserName,
        [bool]$UseWhatIf
    )

    if (-not $PSCommandPath) {
        throw 'The installer must be run from a saved .ps1 file in order to elevate.'
    }

    $handoff = New-ElevationHandoff `
        -ResolvedProfilePath $ResolvedProfilePath `
        -ResolvedFirefoxPath $ResolvedFirefoxPath `
        -ResolvedSourceScript $ResolvedSourceScript `
        -UserSid $UserSid `
        -UserName $UserName

    $arguments = New-Object -TypeName 'System.Collections.Generic.List[string]'
    foreach ($value in @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File')) {
        $arguments.Add($value) | Out-Null
    }
    $arguments.Add((Quote-ProcessArgument $PSCommandPath)) | Out-Null
    $arguments.Add('-ElevationHandoffPath') | Out-Null
    $arguments.Add((Quote-ProcessArgument $handoff.Path)) | Out-Null
    $arguments.Add('-ElevationHandoffSha256') | Out-Null
    $arguments.Add($handoff.Sha256) | Out-Null
    $arguments.Add('-NoElevation') | Out-Null

    if ($UseWhatIf) {
        $arguments.Add('-WhatIf') | Out-Null
    }

    Write-Info 'Requesting administrator privileges...'

    try {
        $process = Start-Process `
            -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
            -Verb RunAs `
            -ArgumentList ($arguments -join ' ') `
            -Wait `
            -PassThru

        exit $process.ExitCode
    } catch {
        if ($_.Exception.NativeErrorCode -eq 1223) {
            Write-WarningMessage 'Administrator elevation was cancelled.'
            exit 1223
        }
        throw
    } finally {
        if (Test-Path -LiteralPath $handoff.Path -PathType Leaf) {
            Remove-Item -LiteralPath $handoff.Path -Force -ErrorAction SilentlyContinue
        }
    }
}

function Ensure-FirefoxClosed {
    $running = @(Get-Process firefox -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        throw 'Firefox is running. Close every Firefox window and rerun the installer.'
    }
}

function New-BackupDirectory {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupRoot = Join-Path $env:ProgramData "ExtensionSwitchboard\Backups\$timestamp"
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    return $backupRoot
}

function Backup-FileIfPresent {
    param(
        [string]$Path,
        [string]$BackupDirectory,
        [string]$BackupName
    )

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupDirectory $BackupName) -Force
        Write-Info "Backed up $Path"
    }
}

function Set-DirectoryAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][Security.Principal.SecurityIdentifier[]]$ReadSids
    )

    $administrators = New-Object -TypeName System.Security.Principal.SecurityIdentifier -ArgumentList 'S-1-5-32-544'
    $system = New-Object -TypeName System.Security.Principal.SecurityIdentifier -ArgumentList 'S-1-5-18'
    $acl = New-Object -TypeName System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($administrators)

    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow

    foreach ($sid in @($administrators, $system)) {
        $rule = New-Object -TypeName System.Security.AccessControl.FileSystemAccessRule -ArgumentList @(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            $propagation,
            $allow
        )
        $acl.AddAccessRule($rule)
    }

    foreach ($sid in $ReadSids) {
        $rule = New-Object -TypeName System.Security.AccessControl.FileSystemAccessRule -ArgumentList @(
            $sid,
            [Security.AccessControl.FileSystemRights]::ReadAndExecute,
            $inheritance,
            $propagation,
            $allow
        )
        $acl.AddAccessRule($rule)
    }

    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Set-FileAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][Security.Principal.SecurityIdentifier[]]$ReadSids
    )

    $administrators = New-Object -TypeName System.Security.Principal.SecurityIdentifier -ArgumentList 'S-1-5-32-544'
    $system = New-Object -TypeName System.Security.Principal.SecurityIdentifier -ArgumentList 'S-1-5-18'
    $acl = New-Object -TypeName System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($administrators)
    $allow = [Security.AccessControl.AccessControlType]::Allow

    foreach ($sid in @($administrators, $system)) {
        $rule = New-Object -TypeName System.Security.AccessControl.FileSystemAccessRule -ArgumentList @(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $allow
        )
        $acl.AddAccessRule($rule)
    }

    foreach ($sid in $ReadSids) {
        $rule = New-Object -TypeName System.Security.AccessControl.FileSystemAccessRule -ArgumentList @(
            $sid,
            [Security.AccessControl.FileSystemRights]::ReadAndExecute,
            $allow
        )
        $acl.AddAccessRule($rule)
    }

    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-ProtectedInstallPaths {
    param([string]$ResolvedProfilePath)

    $leaf = Split-Path $ResolvedProfilePath -Leaf
    $safeLeaf = $leaf -replace '[^A-Za-z0-9._-]', '_'
    $hash = Get-StringSha256Prefix -Value $ResolvedProfilePath.ToLowerInvariant()
    $root = Join-Path $env:ProgramData 'ExtensionSwitchboard'
    $profilesRoot = Join-Path $root 'Profiles'
    $profileDirectory = Join-Path $profilesRoot "$safeLeaf-$hash"

    return [pscustomobject]@{
        Root = $root
        ProfilesRoot = $profilesRoot
        ProfileDirectory = $profileDirectory
        ScriptPath = Join-Path $profileDirectory 'ExtensionSwitchboard.uc.js'
        BackupRoot = Join-Path $root 'Backups'
    }
}

function Protect-InstallTree {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][Security.Principal.SecurityIdentifier]$UserSid
    )

    $users = New-Object -TypeName System.Security.Principal.SecurityIdentifier -ArgumentList 'S-1-5-32-545'

    Set-DirectoryAcl -Path $Paths.Root -ReadSids @($users)
    Set-DirectoryAcl -Path $Paths.ProfilesRoot -ReadSids @($users)
    Set-DirectoryAcl -Path $Paths.ProfileDirectory -ReadSids @($UserSid)
    Set-FileAcl -Path $Paths.ScriptPath -ReadSids @($UserSid)

    if (Test-Path -LiteralPath $Paths.BackupRoot -PathType Container) {
        Set-DirectoryAcl -Path $Paths.BackupRoot -ReadSids @()
    }
}

function Set-PrefInText {
    param(
        [string]$Text,
        [string]$PreferenceName,
        [string]$JavaScriptValue
    )

    $pattern = '(?m)^\s*(?:pref|defaultPref|lockPref)\(\s*"' + `
        [Regex]::Escape($PreferenceName) + '"\s*,\s*[^;]*\);\s*$'
    $line = 'pref("{0}", {1});' -f $PreferenceName, $JavaScriptValue

    if ([Regex]::IsMatch($Text, $pattern)) {
        return [Regex]::Replace($Text, $pattern, $line)
    }

    if ($Text.Length -gt 0 -and -not $Text.EndsWith("`n")) {
        $Text += "`n"
    }

    return $Text + $line + "`n"
}

function Get-AutoConfigFilename {
    param([string]$AutoConfigText)

    $match = [Regex]::Match(
        $AutoConfigText,
        'general\.config\.filename"\s*,\s*"([^"\\/]+)"'
    )

    if ($match.Success) {
        return $match.Groups[1].Value
    }

    return 'firefox.cfg'
}

function Update-AutoConfigPreferences {
    param(
        [string]$Path,
        [string]$ConfigFilename
    )

    $text = if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Read-AllText -Path $Path
    } else {
        "// Extension Switchboard AutoConfig preferences.`n"
    }

    if (-not $text.TrimStart().StartsWith('//')) {
        $text = "// Firefox AutoConfig preferences.`n" + $text
    }

    $text = Set-PrefInText `
        -Text $text `
        -PreferenceName 'general.config.filename' `
        -JavaScriptValue (ConvertTo-JavaScriptString $ConfigFilename)
    $text = Set-PrefInText `
        -Text $text `
        -PreferenceName 'general.config.obscure_value' `
        -JavaScriptValue '0'
    $text = Set-PrefInText `
        -Text $text `
        -PreferenceName 'general.config.sandbox_enabled' `
        -JavaScriptValue 'false'

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Write-Utf8NoBomLf -Path $Path -Text $text
}

function New-LoaderBlock {
    param(
        [string]$ResolvedProfilePath,
        [string]$ProtectedScriptPath
    )

    $template = @'
// BEGIN EXTENSION SWITCHBOARD MANAGED LOADER
(() => {
    "use strict";

    const TARGET_PROFILE = __TARGET_PROFILE__;
    const SCRIPT_PATH = __SCRIPT_PATH__;
    const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

    const observerService = Cc["@mozilla.org/observer-service;1"]
        .getService(Ci.nsIObserverService);
    const windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"]
        .getService(Ci.nsIWindowMediator);
    const directoryService = Cc["@mozilla.org/file/directory_service;1"]
        .getService(Ci.nsIProperties);
    const ioService = Cc["@mozilla.org/network/io-service;1"]
        .getService(Ci.nsIIOService);
    const scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
        .getService(Ci.mozIJSSubScriptLoader);

    const currentProfile = directoryService.get("ProfD", Ci.nsIFile).path;
    if (currentProfile.toLowerCase() !== TARGET_PROFILE.toLowerCase()) {
        return;
    }

    const scriptFile = Cc["@mozilla.org/file/local;1"]
        .createInstance(Ci.nsIFile);
    scriptFile.initWithPath(SCRIPT_PATH);

    const report = message => {
        Cu.reportError(`Extension Switchboard loader: ${message}`);
    };

    const loadIntoWindow = win => {
        try {
            if (
                !win ||
                win.closed ||
                win.document.documentElement.getAttribute("windowtype") !==
                    "navigator:browser" ||
                win.__extensionSwitchboardLoaded
            ) {
                return;
            }

            if (!scriptFile.exists() || !scriptFile.isFile()) {
                report(`Protected script not found: ${scriptFile.path}`);
                return;
            }

            win.__extensionSwitchboardLoaded = true;
            scriptLoader.loadSubScript(
                ioService.newFileURI(scriptFile).spec,
                win,
                "UTF-8"
            );
        } catch (error) {
            try {
                win.__extensionSwitchboardLoaded = false;
            } catch {}
            report(error?.stack || error);
        }
    };

    const delayedStartupObserver = {
        observe(subject, topic) {
            if (topic === "browser-delayed-startup-finished") {
                loadIntoWindow(subject);
            }
        }
    };

    observerService.addObserver(
        delayedStartupObserver,
        "browser-delayed-startup-finished"
    );

    const windows = windowMediator.getEnumerator("navigator:browser");
    while (windows.hasMoreElements()) {
        const win = windows.getNext();
        if (win.gBrowserInit?.delayedStartupFinished) {
            loadIntoWindow(win);
        }
    }
})();
// END EXTENSION SWITCHBOARD MANAGED LOADER
'@

    return $template.Replace(
        '__TARGET_PROFILE__',
        (ConvertTo-JavaScriptString $ResolvedProfilePath)
    ).Replace(
        '__SCRIPT_PATH__',
        (ConvertTo-JavaScriptString $ProtectedScriptPath)
    )
}

function Install-LoaderBlock {
    param(
        [string]$ConfigPath,
        [string]$LoaderBlock
    )

    $text = if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
        Read-AllText -Path $ConfigPath
    } else {
        "// Firefox AutoConfig file. The first line must be a comment.`n"
    }

    if (-not $text.TrimStart().StartsWith('//')) {
        $text = "// Firefox AutoConfig file. The first line must be a comment.`n" + $text
    }

    $managedPattern = '(?s)' + [Regex]::Escape($Script:ManagedBegin) + `
        '.*?' + [Regex]::Escape($Script:ManagedEnd)

    if ([Regex]::IsMatch($text, $managedPattern)) {
        $text = [Regex]::Replace($text, $managedPattern, $LoaderBlock)
    } else {
        $existingHash = $null
        if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
            $existingHash = Get-Sha256 -Path $ConfigPath
        }

        if ($existingHash -eq $Script:LegacyLoaderSha256) {
            $text = "// Firefox AutoConfig file. The first line must be a comment.`n`n$LoaderBlock`n"
        } elseif (
            $text -match 'Extension Switchboard AutoConfig bootstrap' -and
            $text -match 'directoryService\.get\("UChrm"'
        ) {
            throw @"
The existing AutoConfig file contains a legacy Extension Switchboard loader,
but it is not the exact known standalone loader. The installer will not modify
it automatically because it may contain other custom code. Back it up, remove
the old Extension Switchboard loader manually, and rerun this installer.
Config file: $ConfigPath
"@
        } else {
            if (-not $text.EndsWith("`n")) {
                $text += "`n"
            }
            $text += "`n$LoaderBlock`n"
        }
    }

    Write-Utf8NoBomLf -Path $ConfigPath -Text $text
}

function Remove-LoaderBlock {
    param([string]$ConfigPath)

    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        return $false
    }

    $text = Read-AllText -Path $ConfigPath
    $managedPattern = '(?s)\s*' + [Regex]::Escape($Script:ManagedBegin) + `
        '.*?' + [Regex]::Escape($Script:ManagedEnd) + '\s*'

    if (-not [Regex]::IsMatch($text, $managedPattern)) {
        return $false
    }

    $text = [Regex]::Replace($text, $managedPattern, "`n")
    Write-Utf8NoBomLf -Path $ConfigPath -Text ($text.TrimEnd() + "`n")
    return $true
}

function Get-InstallContext {
    param(
        [string]$ResolvedProfilePath,
        [string]$ResolvedFirefoxPath
    )

    $autoConfigPath = Join-Path $ResolvedFirefoxPath 'defaults\pref\autoconfig.js'
    $autoConfigText = if (Test-Path -LiteralPath $autoConfigPath -PathType Leaf) {
        Read-AllText -Path $autoConfigPath
    } else {
        ''
    }
    $configFilename = Get-AutoConfigFilename -AutoConfigText $autoConfigText

    if ($configFilename.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
        throw "The configured AutoConfig filename is invalid: $configFilename"
    }

    $paths = Get-ProtectedInstallPaths -ResolvedProfilePath $ResolvedProfilePath

    return [pscustomobject]@{
        ProfilePath = $ResolvedProfilePath
        FirefoxInstallPath = $ResolvedFirefoxPath
        AutoConfigPath = $autoConfigPath
        ConfigFilename = $configFilename
        ConfigPath = Join-Path $ResolvedFirefoxPath $configFilename
        Protected = $paths
        LegacyProfileScript = Join-Path $ResolvedProfilePath 'chrome\ExtensionSwitchboard.uc.js'
    }
}

function Install-ExtensionSwitchboard {
    param(
        [Parameter(Mandatory = $true)]$Context,
        [Parameter(Mandatory = $true)][string]$ResolvedSourceScript,
        [Parameter(Mandatory = $true)][Security.Principal.SecurityIdentifier]$UserSid
    )

    # Ensure-FirefoxClosed

    $sourceVersion = Get-ExtensionSwitchboardVersion -Path $ResolvedSourceScript
    Write-Info "Installing Extension Switchboard v$sourceVersion"

    $backupDirectory = New-BackupDirectory
    Backup-FileIfPresent -Path $Context.AutoConfigPath -BackupDirectory $backupDirectory -BackupName 'autoconfig.js'
    Backup-FileIfPresent -Path $Context.ConfigPath -BackupDirectory $backupDirectory -BackupName $Context.ConfigFilename
    Backup-FileIfPresent -Path $Context.Protected.ScriptPath -BackupDirectory $backupDirectory -BackupName 'ExtensionSwitchboard.protected.previous.uc.js'
    Backup-FileIfPresent -Path $Context.LegacyProfileScript -BackupDirectory $backupDirectory -BackupName 'ExtensionSwitchboard.profile.previous.uc.js'

    New-Item -ItemType Directory -Path $Context.Protected.ProfileDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $Context.Protected.BackupRoot -Force | Out-Null

    Copy-Item -LiteralPath $ResolvedSourceScript -Destination $Context.Protected.ScriptPath -Force

    Update-AutoConfigPreferences `
        -Path $Context.AutoConfigPath `
        -ConfigFilename $Context.ConfigFilename

    $loaderBlock = New-LoaderBlock `
        -ResolvedProfilePath $Context.ProfilePath `
        -ProtectedScriptPath $Context.Protected.ScriptPath
    Install-LoaderBlock -ConfigPath $Context.ConfigPath -LoaderBlock $loaderBlock

    Protect-InstallTree -Paths $Context.Protected -UserSid $UserSid

    if (-not $KeepLegacyProfileScript -and (Test-Path -LiteralPath $Context.LegacyProfileScript -PathType Leaf)) {
        Remove-Item -LiteralPath $Context.LegacyProfileScript -Force
        Write-Info "Removed the legacy user-writable profile script after backing it up."
    }

    $sourceHash = Get-Sha256 -Path $ResolvedSourceScript
    $installedHash = Get-Sha256 -Path $Context.Protected.ScriptPath
    if ($sourceHash -ne $installedHash) {
        throw 'The installed script hash does not match the source script hash.'
    }

    Write-Success "$Script:ProductName installed for profile: $($Context.ProfilePath)"
    Write-Success "Protected script: $($Context.Protected.ScriptPath)"
    Write-Success "Firefox AutoConfig: $($Context.ConfigPath)"
    Write-Success "Backups: $backupDirectory"
    Write-Host ''
    Write-Host 'Restart Firefox normally. Do not run Firefox as administrator.' -ForegroundColor White
}

function Verify-ExtensionSwitchboard {
    param(
        [Parameter(Mandatory = $true)]$Context,
        [Parameter(Mandatory = $true)][Security.Principal.SecurityIdentifier]$UserSid
    )

    $failures = New-Object -TypeName 'System.Collections.Generic.List[string]'

    foreach ($path in @(
        $Context.AutoConfigPath,
        $Context.ConfigPath,
        $Context.Protected.ScriptPath
    )) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Write-Success "Found $path"
        } else {
            $failures.Add("Missing file: $path") | Out-Null
        }
    }

    if (Test-Path -LiteralPath $Context.AutoConfigPath -PathType Leaf) {
        $text = Read-AllText -Path $Context.AutoConfigPath
        foreach ($required in @(
            'general.config.filename',
            'general.config.obscure_value',
            'general.config.sandbox_enabled'
        )) {
            if ($text -notmatch [Regex]::Escape($required)) {
                $failures.Add("Missing AutoConfig preference: $required") | Out-Null
            }
        }
    }

    if (Test-Path -LiteralPath $Context.ConfigPath -PathType Leaf) {
        $text = Read-AllText -Path $Context.ConfigPath
        if ($text -notmatch [Regex]::Escape($Script:ManagedBegin)) {
            $failures.Add('Managed Extension Switchboard loader block is missing.') | Out-Null
        }
        $protectedScriptLiteral = ConvertTo-JavaScriptString `
            -Value $Context.Protected.ScriptPath
        if (-not $text.Contains($protectedScriptLiteral)) {
            $failures.Add('Managed loader does not reference the expected protected script path.') | Out-Null
        }
    }

    if (Test-Path -LiteralPath $Context.Protected.ScriptPath -PathType Leaf) {
        $acl = Get-Acl -LiteralPath $Context.Protected.ScriptPath
        if (-not $acl.AreAccessRulesProtected) {
            $failures.Add('Protected script still inherits permissions.') | Out-Null
        }

        $targetRule = @($acl.Access | Where-Object {
            $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $UserSid.Value
        })
        if ($targetRule.Count -eq 0) {
            $failures.Add('Target user has no explicit read rule on the protected script.') | Out-Null
        }
    }

    if ($failures.Count -gt 0) {
        foreach ($failure in $failures) {
            Write-WarningMessage $failure
        }
        throw "Verification failed with $($failures.Count) issue(s)."
    }

    Write-Success 'Installation verification passed.'
}

function Uninstall-ExtensionSwitchboard {
    param([Parameter(Mandatory = $true)]$Context)

    Ensure-FirefoxClosed
    $backupDirectory = New-BackupDirectory
    Backup-FileIfPresent -Path $Context.ConfigPath -BackupDirectory $backupDirectory -BackupName $Context.ConfigFilename
    Backup-FileIfPresent -Path $Context.Protected.ScriptPath -BackupDirectory $backupDirectory -BackupName 'ExtensionSwitchboard.protected.uc.js'

    $removedBlock = Remove-LoaderBlock -ConfigPath $Context.ConfigPath
    if ($removedBlock) {
        Write-Info 'Removed the managed loader block from Firefox AutoConfig.'
    } else {
        Write-WarningMessage 'No managed loader block was found in Firefox AutoConfig.'
    }

    if (Test-Path -LiteralPath $Context.Protected.ProfileDirectory -PathType Container) {
        Remove-Item -LiteralPath $Context.Protected.ProfileDirectory -Recurse -Force
        Write-Info 'Removed the protected profile-specific program directory.'
    }

    Write-Success "$Script:ProductName uninstalled for this profile."
    Write-Info 'The shared AutoConfig preferences were retained because other customizations may use them.'
    Write-Info "Backups: $backupDirectory"
}

$stagedSourceDirectory = $null
$installerExitCode = 0

try {
    if ($env:OS -ne 'Windows_NT') {
        throw 'This installer supports Windows only.'
    }

    $resolvedProfile = $null
    $resolvedFirefox = $null
    $resolvedSource = $null

    if ($ElevationHandoffPath -or $ElevationHandoffSha256) {
        if (-not $ElevationHandoffPath -or -not $ElevationHandoffSha256) {
            throw 'Both elevation handoff parameters are required.'
        }
        if (-not (Test-IsAdministrator)) {
            throw 'The elevation handoff can only be processed by an administrator.'
        }

        $handoff = Import-ElevationHandoff `
            -Path $ElevationHandoffPath `
            -ExpectedSha256 $ElevationHandoffSha256

        Remove-Item `
            -LiteralPath $ElevationHandoffPath `
            -Force `
            -ErrorAction SilentlyContinue

        $Action = [string]$handoff.Action
        $resolvedProfile = Resolve-FullPath -Path ([string]$handoff.ProfilePath)
        $resolvedFirefox = Resolve-FullPath -Path ([string]$handoff.FirefoxInstallPath)
        $TargetUserSid = [string]$handoff.TargetUserSid
        $TargetUserName = [string]$handoff.TargetUserName
        $KeepLegacyProfileScript = [bool]$handoff.KeepLegacyProfileScript

        if ($Action -eq 'Install') {
            $stagedSource = New-StagedSourceFromHandoff -Payload $handoff
            $resolvedSource = $stagedSource.Path
            $stagedSourceDirectory = $stagedSource.Directory
        }
    } else {
        $launchIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
        if (-not $TargetUserSid) {
            $TargetUserSid = $launchIdentity.User.Value
        }
        if (-not $TargetUserName) {
            $TargetUserName = $launchIdentity.Name
        }

        $resolvedProfile = Resolve-TargetProfilePath -RequestedPath $ProfilePath
        $resolvedFirefox = Resolve-FirefoxInstallPath -RequestedPath $FirefoxInstallPath
        if ($Action -eq 'Install') {
            $resolvedSource = Resolve-SourceScriptPath -RequestedPath $SourceScript
        }

        if (-not (Test-IsAdministrator)) {
            if ($NoElevation) {
                throw 'Administrator privileges are required.'
            }

            Start-ElevatedCopy `
                -ResolvedProfilePath $resolvedProfile `
                -ResolvedFirefoxPath $resolvedFirefox `
                -ResolvedSourceScript $resolvedSource `
                -UserSid $TargetUserSid `
                -UserName $TargetUserName `
                -UseWhatIf ([bool]$WhatIfPreference)
        }
    }

    $targetSidObject = New-Object `
        -TypeName System.Security.Principal.SecurityIdentifier `
        -ArgumentList $TargetUserSid
    $context = Get-InstallContext `
        -ResolvedProfilePath $resolvedProfile `
        -ResolvedFirefoxPath $resolvedFirefox

    Write-Info "Action: $Action"
    Write-Info "Target user: $TargetUserName ($TargetUserSid)"
    Write-Info "Firefox profile: $resolvedProfile"
    Write-Info "Firefox installation: $resolvedFirefox"

    switch ($Action) {
        'Install' {
            Install-ExtensionSwitchboard `
                -Context $context `
                -ResolvedSourceScript $resolvedSource `
                -UserSid $targetSidObject
            Verify-ExtensionSwitchboard -Context $context -UserSid $targetSidObject
        }
        'Verify' {
            Verify-ExtensionSwitchboard -Context $context -UserSid $targetSidObject
        }
        'Uninstall' {
            Uninstall-ExtensionSwitchboard -Context $context
        }
    }
} catch {
    Write-Host ''
    Write-Host "Extension Switchboard installer failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ScriptStackTrace) {
        Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
    }
    $installerExitCode = 1
} finally {
    if (
        $stagedSourceDirectory -and
        (Test-Path -LiteralPath $stagedSourceDirectory -PathType Container)
    ) {
        Remove-Item `
            -LiteralPath $stagedSourceDirectory `
            -Recurse `
            -Force `
            -ErrorAction SilentlyContinue
    }

    if (
        $ElevationHandoffPath -and
        (Test-Path -LiteralPath $ElevationHandoffPath -PathType Leaf)
    ) {
        Remove-Item `
            -LiteralPath $ElevationHandoffPath `
            -Force `
            -ErrorAction SilentlyContinue
    }
}

exit $installerExitCode
