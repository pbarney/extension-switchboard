#requires -Version 5.1

[CmdletBinding()]
param(
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
        throw 'The test runner must be run from a saved .ps1 file in order to elevate.'
    }

    $arguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', (Quote-ProcessArgument $PSCommandPath),
        '-RepositoryRoot', (Quote-ProcessArgument $RepositoryRoot),
        '-TargetUserSid', (Quote-ProcessArgument $TargetUserSid),
        '-TargetUserName', (Quote-ProcessArgument $TargetUserName),
        '-NoElevation'
    )

    if ($KeepTestArtifacts) {
        $arguments += '-KeepTestArtifacts'
    }

    Write-Host 'Requesting administrator privileges for the installer tests...' `
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
        throw 'Administrator privileges are required to run the installer tests.'
    }
    Start-ElevatedCopy
}

if (-not (Test-Path -LiteralPath $RepositoryRoot -PathType Container)) {
    throw "Repository root does not exist: $RepositoryRoot"
}

$scenarioRunner = Join-Path $testRoot 'Run-TestScenario.ps1'
if (-not (Test-Path -LiteralPath $scenarioRunner -PathType Leaf)) {
    throw "Scenario runner does not exist: $scenarioRunner"
}

$scenarios = @(
    '01-clean-install',
    '02-shared-existing-config',
    '03-custom-config-filename',
    '04-existing-managed-block',
    '05-known-legacy-standalone',
    '06-modified-legacy-loader-refusal',
    '07-invalid-config-filename',
    '08-comment-and-line-ending-repair'
)

$failed = @()
foreach ($scenario in $scenarios) {
    Write-Host "`n============================================================" -ForegroundColor DarkCyan
    Write-Host $scenario -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkCyan
    try {
        & $scenarioRunner `
            -Scenario $scenario `
            -KeepTestArtifacts:$KeepTestArtifacts `
            -RepositoryRoot $RepositoryRoot `
            -TargetUserSid $TargetUserSid `
            -TargetUserName $TargetUserName `
            -NoElevation
    } catch {
        $failed += $scenario
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
}

if ($failed.Count) {
    Write-Host "`nFailed scenarios: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "`nAll scenarios passed." -ForegroundColor Green
