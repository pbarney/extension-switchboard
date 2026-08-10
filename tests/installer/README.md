# Extension Switchboard installer test fixtures

These fixtures exercise how `Install-ExtensionSwitchboard.ps1` handles existing
`autoconfig.js` and `.cfg` files. They use a disposable fake Firefox installation
and fake profile. They do not modify your real Firefox installation or profile,
and Firefox does not need to be closed while the tests run.

## Requirements

- Windows PowerShell 5.1
- An NTFS volume

Administrator rights are required for the ACL and `%ProgramData%` tests, but the
installer and both test runners request elevation automatically. If separate
administrator credentials are entered, the initiating user's SID and name are
preserved and passed to the elevated process.

## Run one scenario

From an ordinary Windows PowerShell window:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\Run-TestScenario.ps1 -Scenario 02-shared-existing-config
```

Accept the UAC prompt.

Run every scenario with one UAC prompt:

```powershell
.\Run-AllScenarios.ps1
```

`Run-AllScenarios.ps1` elevates once, then invokes each scenario inside the same
elevated process. `Run-TestScenario.ps1` also self-elevates when run directly.

Expected refusal scenarios return installer exit code 1 but are counted as
successful tests when the expected error and file-preservation checks pass.

## Artifact cleanup

By default, each scenario removes all disposable artifacts in a `finally` block,
even when an assertion fails. This includes:

- the scenario's `Work\<scenario>` directory
- the fixture-specific protected profile under `%ProgramData%`
- backup directories created by that scenario
- empty `Profiles`, `Backups`, and `ExtensionSwitchboard` parent directories

Pre-existing backup directories and unrelated protected profiles are preserved.

To retain both the staged work files and `%ProgramData%` artifacts for diagnosis:

```powershell
.\Run-TestScenario.ps1 01-clean-install -KeepTestArtifacts
```

or:

```powershell
.\Run-AllScenarios.ps1 -KeepTestArtifacts
```

`-KeepInstallerArtifacts` remains accepted as a compatibility alias.

## Scenarios

1. `01-clean-install`: no pre-existing AutoConfig files.
2. `02-shared-existing-config`: unrelated preferences and shared `.cfg` code must survive.
3. `03-custom-config-filename`: a custom config filename must be respected; a decoy `firefox.cfg` must remain untouched.
4. `04-existing-managed-block`: an existing managed loader block must be replaced exactly once.
5. `05-known-legacy-standalone`: the exact known old standalone loader must be replaced.
6. `06-modified-legacy-loader-refusal`: a modified legacy loader mixed with other code must make the installer refuse to rewrite that `.cfg` file.
7. `07-invalid-config-filename`: an invalid configured filename must fail before modification.
8. `08-comment-and-line-ending-repair`: missing first-line comments and line endings must be repaired while preserving unrelated content.

## Elevation behavior

The installer resolves the intended Firefox profile, installation, user SID, and
source script before elevation. It passes those values through a SHA-256-verified
temporary JSON handoff. For installation, the source script bytes are included in
that handoff and are staged under an administrator-only directory before use.

The `-NoElevation` switch is intended for the already-elevated test harness and
advanced automation. It makes a non-elevated invocation fail rather than prompt.

## Important caveat

The tests invoke the real installer, including ACL creation under `%ProgramData%`.
The harness removes the fixture-specific protected script directory and any new
backup directories afterward unless `-KeepInstallerArtifacts` is specified.
The disposable staged `Work` directory is retained for inspection.
