# Installation, upgrade, rollback, and removal

## Recommended installation

The recommended Windows installation uses `Install-ExtensionSwitchboard.ps1`.

The installer:

- resolves the target Firefox installation and profile before elevation;
- requests administrator privileges through UAC;
- backs up existing AutoConfig and Extension Switchboard files;
- installs the privileged script under `%ProgramData%\ExtensionSwitchboard\Profiles\...`;
- restricts the installed script with NTFS permissions;
- creates or updates the required Firefox AutoConfig preferences;
- adds or replaces the managed Extension Switchboard loader block;
- preserves unrelated AutoConfig content;
- removes the older user-writable profile copy after backing it up;
- verifies the completed installation.

Firefox needs to be completely closed while installing or upgrading.

### From a release package

1. Extract the release.
2. Optionally verify the published ZIP and file checksums (*see below*).
3. Exit Firefox completely.
4. Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-ExtensionSwitchboard.ps1
```

5. Approve the UAC prompt.
6. Restart Firefox normally.

If more than one Firefox installation or profile is detected, the installer prompts for the target.

#### To verify the file hashes, run this command in Powershell:

```
Get-FileHash <filename-of-downloaded-release-package> -Algorithm SHA256
```

Compare the output of that command with the `SHA256` file included in the release package.

### From the repository

The canonical files are:

```text
src\ExtensionSwitchboard.uc.js
installer\windows\Install-ExtensionSwitchboard.ps1
```

From the repository root:

```powershell
.\installer\windows\Install-ExtensionSwitchboard.ps1 `
    -SourceScript .\src\ExtensionSwitchboard.uc.js
```

The installer still performs its own elevation.

## Existing AutoConfig installations

The installer is designed to preserve any unrelated AutoConfig content.

If `autoconfig.js` or the configured `.cfg` file already exists, the installer backs it up and modifies only the parts it manages.

Backups are stored under:

```text
%ProgramData%\ExtensionSwitchboard\Backups\
```

## Upgrade

Upgrades use the same path as installation. No uninstall is required before upgrading.

1. Extract the newer release.
2. Exit Firefox completely.
3. Run the newer `Install-ExtensionSwitchboard.ps1`.
4. Restart Firefox.

The installer backs up the current files, replaces the protected script, refreshes the managed loader configuration, reapplies permissions, and verifies the installation.

Saved categories and assignments remain.

## Verify an installation

With Firefox closed:

```powershell
.\Install-ExtensionSwitchboard.ps1 -Action Verify
```

Verification checks the required AutoConfig files, managed loader, protected script, and expected permissions.

## Rollback

The simplest rollback is to run the installer from a previous known-working release.

1. Exit Firefox completely.
2. Extract the previous release.
3. Run its installer normally.
4. Restart Firefox.

Installer-created backups under `%ProgramData%\ExtensionSwitchboard\Backups\` are also available for manual recovery if needed.

Configuration stored in `extensionSwitchboard.config` isn't removed by a normal reinstall or rollback.

## Uninstall

With Firefox closed:

```powershell 
.\Install-ExtensionSwitchboard.ps1 -Action Uninstall
```

The installer removes the script and the Extension Switchboard loader block from the `firefox.cfg`.

It **doesn't** blindly delete shared AutoConfig files or preferences, because other Firefox customizations could be using them. Review the remaining AutoConfig configuration afterward.

If no remaining AutoConfig code requires privileged execution, you can turn the AutoConfig sandbox back on. Reset this:

```javascript
pref("general.config.sandbox_enabled", false);
```

The normal secure setting is:

```javascript
pref("general.config.sandbox_enabled", true);
```

Removing Extension Switchboard doesn't change the current enabled/disabled state of extensions.

To remove your saved categories and assignments, go to `about:config` and delete `extensionSwitchboard.config`.

## Manual installation

A manual installation is documented in:

[installer/manual/README.md](../installer/manual/README.md)

The manual method loads `ExtensionSwitchboard.uc.js` from the Firefox profile. That may be useful for advanced/manual setups but it's more prone to local tampering than using the installation program, so only proceed with that for quick testing or if you really understand what you're doing.

## Requirements and unsupported installations

Using the installer assumes:

- Windows PowerShell 5.1 or later;
- NTFS permissions;
- a standard desktop Firefox installation;
- permission to approve administrator elevation.

Microsoft Store/MSIX, Snap, Flatpak, and similar packaged Firefox distributions might use different or read-only installation layouts and aren't supported by the Windows installer.

For problems, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
