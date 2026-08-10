#requires -Version 5.1


<#

.SYNOPSIS

Assembles and packages an Extension Switchboard release from canonical

repository files.



.DESCRIPTION

The script:



1. Resolves the repository root.

2. Reads and validates the release version from VERSION.

3. Creates a fresh versioned package under dist.

4. Copies only explicitly listed canonical source files.

5. Writes SHA256SUMS inside the package.

6. Creates a ZIP containing the versioned package directory.

7. Writes a SHA-256 checksum for the final ZIP.



The script does not run the installer test suite. Run tests separately before

building a release.



.EXAMPLE

.\scripts\release\Build-Release.ps1 -Force



.EXAMPLE

.\scripts\release\Build-Release.ps1 `

    -RepositoryRoot C:\src\extension-switchboard `

    -Force

#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$RepositoryRoot,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$OutputDirectory = 'dist',

    [Parameter()]
    [switch]$Force
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Resolve-NativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter()]
        [string]$BasePath
    )

    if ([IO.Path]::IsPathRooted($Path)) {
        return [IO.Path]::GetFullPath($Path)
    }

    if (-not [string]::IsNullOrWhiteSpace($BasePath)) {
        return [IO.Path]::GetFullPath(
            (Join-Path $BasePath $Path)
        )
    }

    return $ExecutionContext.SessionState.Path.
        GetUnresolvedProviderPathFromPSPath($Path)
}

function Get-NormalizedVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $normalized = $Value.Trim()
    if ($normalized.StartsWith('v', [StringComparison]::OrdinalIgnoreCase)) {
        $normalized = $normalized.Substring(1)
    }

    if (
        $normalized -notmatch
            '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$'
    ) {
        throw "Invalid release version: $Value"
    }

    return $normalized
}

function Write-Utf8NoBomLines {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Lines
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllLines($Path, $Lines, $encoding)
}

function Get-RelativePathPs5 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseDirectory,

        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    $basePath = [IO.Path]::GetFullPath($BaseDirectory)
    $targetFullPath = [IO.Path]::GetFullPath($TargetPath)

    if (-not $basePath.EndsWith('\')) {
        $basePath += '\'
    }

    $baseUri = New-Object Uri($basePath)
    $targetUri = New-Object Uri($targetFullPath)
    $relativeUri = $baseUri.MakeRelativeUri($targetUri)

    return [Uri]::UnescapeDataString(
        $relativeUri.ToString()
    ).Replace('\', '/')
}

function Remove-BuildOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    if (-not $Force) {
        throw "$Description already exists: $Path`nUse -Force to replace it."
    }

    Remove-Item -LiteralPath $Path -Recurse -Force
}

function Copy-ReleaseFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    $destinationDirectory = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $destinationDirectory)) {
        New-Item `
            -ItemType Directory `
            -Path $destinationDirectory `
            -Force |
            Out-Null
    }

    Copy-Item `
        -LiteralPath $Source `
        -Destination $Destination `
        -Force
}

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    if (-not $PSScriptRoot) {
        throw 'RepositoryRoot is required when the script location is unavailable.'
    }

    $RepositoryRoot = Resolve-NativePath `
        -Path '..\..' `
        -BasePath $PSScriptRoot
} else {
    $RepositoryRoot = Resolve-NativePath -Path $RepositoryRoot
}

if (-not (Test-Path -LiteralPath $RepositoryRoot -PathType Container)) {
    throw "Repository root does not exist: $RepositoryRoot"
}

$versionFile = Join-Path $RepositoryRoot 'VERSION'
if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) {
    throw "VERSION file does not exist: $versionFile"
}

$Version = Get-NormalizedVersion -Value (
    Get-Content -LiteralPath $versionFile -Raw
)

$outputRoot = Resolve-NativePath `
    -Path $OutputDirectory `
    -BasePath $RepositoryRoot

$packageName = "ExtensionSwitchboard-v$Version"
$packageRoot = Join-Path $outputRoot $packageName
$zipPath = Join-Path $outputRoot "$packageName.zip"
$zipChecksumPath = "$zipPath.sha256"
$fileManifestPath = Join-Path $packageRoot 'SHA256SUMS'

# This explicit manifest is the release contract. Add files here deliberately.

$releaseFiles = @(
    @{
        Source = 'src\ExtensionSwitchboard.uc.js'
        Destination = 'ExtensionSwitchboard.uc.js'
    },
    @{
        Source = 'installer\windows\Install-ExtensionSwitchboard.ps1'
        Destination = 'installer\windows\Install-ExtensionSwitchboard.ps1'
    },
    @{
        Source = 'installer\windows\README.md'
        Destination = 'installer\windows\README.md'
    },
    @{
        Source = 'installer\manual\README.md'
        Destination = 'installer\manual\README.md'
    },
    @{
        Source = 'installer\manual\autoconfig.js'
        Destination = 'installer\manual\autoconfig.js'
    },
    @{
        Source = 'installer\manual\firefox.cfg'
        Destination = 'installer\manual\firefox.cfg'
    },
    @{
        Source = 'docs\CONFIGURATION.md'
        Destination = 'docs\CONFIGURATION.md'
    },
    @{
        Source = 'docs\INSTALLATION.md'
        Destination = 'docs\INSTALLATION.md'
    },
    @{
        Source = 'docs\TESTING.md'
        Destination = 'docs\TESTING.md'
    },
    @{
        Source = 'docs\TROUBLESHOOTING.md'
        Destination = 'docs\TROUBLESHOOTING.md'
    },
    @{
        Source = 'docs\SECURITY.md'
        Destination = 'SECURITY.md'
    },
    @{
        Source = 'README.md'
        Destination = 'README.md'
    },
    @{
        Source = 'CHANGELOG.md'
        Destination = 'CHANGELOG.md'
    },
    @{
        Source = 'RELEASE-NOTES.md'
        Destination = 'RELEASE-NOTES.md'
    },
    @{
        Source = 'LICENSE'
        Destination = 'LICENSE'
    },
    @{
        Source = 'VERSION'
        Destination = 'VERSION'
    }
)

# Validate every canonical input before removing an existing build.

$resolvedReleaseFiles = foreach ($entry in $releaseFiles) {
    $sourcePath = Join-Path $RepositoryRoot $entry.Source

    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required release file does not exist: $sourcePath"
    }

    [pscustomobject]@{
        Source = $sourcePath
        Destination = Join-Path $packageRoot $entry.Destination
    }
}

if (-not $PSCmdlet.ShouldProcess(
    $packageRoot,
    "Assemble and package Extension Switchboard v$Version"
)) {
    return
}

if (-not (Test-Path -LiteralPath $outputRoot)) {
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
}

Remove-BuildOutput `
    -Path $packageRoot `
    -Description 'Versioned package directory'
Remove-BuildOutput `
    -Path $zipPath `
    -Description 'Release ZIP'
Remove-BuildOutput `
    -Path $zipChecksumPath `
    -Description 'ZIP checksum file'

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

foreach ($entry in $resolvedReleaseFiles) {
    Copy-ReleaseFile `
        -Source $entry.Source `
        -Destination $entry.Destination
}

$packageFiles = @(
    Get-ChildItem -LiteralPath $packageRoot -File -Recurse |
        Where-Object {
            $_.FullName -ne $fileManifestPath
        } |
        Sort-Object FullName
)

if ($packageFiles.Count -eq 0) {
    throw 'The assembled package contains no files.'
}

$manifestLines = foreach ($file in $packageFiles) {
    $relativePath = Get-RelativePathPs5 `
        -BaseDirectory $packageRoot `
        -TargetPath $file.FullName

    $hash = (
        Get-FileHash `
            -LiteralPath $file.FullName `
            -Algorithm SHA256
    ).Hash.ToLowerInvariant()

    "$hash  $relativePath"
}

Write-Utf8NoBomLines `
    -Path $fileManifestPath `
    -Lines $manifestLines

Add-Type -AssemblyName System.IO.Compression.FileSystem

[IO.Compression.ZipFile]::CreateFromDirectory(
    $packageRoot,
    $zipPath,
    [IO.Compression.CompressionLevel]::Optimal,
    $true
)

$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $manifestEntry = "$packageName/SHA256SUMS"

    $hasManifest = @(
        $archive.Entries | Where-Object {
            $_.FullName.Replace('\', '/') -eq $manifestEntry
        }
    ).Count -gt 0

    if (-not $hasManifest) {
        throw "The generated ZIP does not contain $manifestEntry."
    }
} finally {
    $archive.Dispose()
}

$zipHash = (
    Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
).Hash.ToLowerInvariant()

Write-Utf8NoBomLines `
    -Path $zipChecksumPath `
    -Lines @("$zipHash  $(Split-Path -Leaf $zipPath)")

Write-Host "[OK] Repository:     $RepositoryRoot"
Write-Host "[OK] Version:        $Version"
Write-Host "[OK] Package:        $packageRoot"
Write-Host "[OK] File checksums: $fileManifestPath"
Write-Host "[OK] Release ZIP:    $zipPath"
Write-Host "[OK] ZIP checksum:   $zipChecksumPath"
Write-Host "[OK] Packaged files: $($packageFiles.Count)"