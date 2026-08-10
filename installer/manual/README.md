# Manual installation

This directory contains the files needed to install Extension Switchboard without using the Windows PowerShell installer.

Manual installation is intended for advanced users who are comfortable locating Firefox profiles, modifying the Firefox installation directory and reviewing privileged AutoConfig code.

> [!WARNING]
> This method loads `ExtensionSwitchboard.uc.js` from the user-writable Firefox profile. The recommended PowerShell installer instead stores the privileged script under `%ProgramData%` with restricted NTFS permissions.
>
> Use the manual method only if you understand and accept that security difference.

## Files

Required:

```text
ExtensionSwitchboard.uc.js
autoconfig.js
firefox.cfg
```

The source script is maintained at:

```text
src\ExtensionSwitchboard.uc.js
```

## Installation

Exit Firefox completely.

Copy the main script to:

```text
<Firefox profile>\chrome\ExtensionSwitchboard.uc.js
```

The target profile can be identified through:

```text
about:profiles
```

Copy `autoconfig.js` to:

```text
<Firefox installation>\defaults\pref\autoconfig.js
```

Copy `firefox.cfg` to:

```text
<Firefox installation>\firefox.cfg
```

The Firefox installation directory is the directory containing `firefox.exe`.

Administrator permission will normally be required for the installation-level files.

## Existing AutoConfig files

Do not blindly overwrite existing `autoconfig.js` or `.cfg` files. They may contain other customizations or enterprise settings.

Back them up and merge the required Extension Switchboard configuration instead.

`autoconfig.js` must configure the selected `.cfg` filename, disable obfuscation and disable the AutoConfig sandbox:

```javascript
pref("general.config.filename", "firefox.cfg");
pref("general.config.obscure_value", 0);
pref("general.config.sandbox_enabled", false);
```

The supplied `firefox.cfg` loads:

```text
<active Firefox profile>\chrome\ExtensionSwitchboard.uc.js
```

## Starting Firefox

Start Firefox normally, not as administrator.

The Extension Switchboard button should appear in the toolbar or under **Customize toolbar**.

For startup errors, open the Browser Console with:

```text
Ctrl+Shift+J
```

and search for:

```text
Extension Switchboard
```

## Updating

Exit Firefox and replace:

```text
<Firefox profile>\chrome\ExtensionSwitchboard.uc.js
```

Review the release notes for any required loader or AutoConfig changes before restarting Firefox.

## Uninstalling

Exit Firefox.

Remove:

```text
<Firefox profile>\chrome\ExtensionSwitchboard.uc.js
```

Then remove the Extension Switchboard loader from:

```text
<Firefox installation>\firefox.cfg
```

Remove `firefox.cfg` or `autoconfig.js` entirely only if no other AutoConfig customization uses them.

If no remaining AutoConfig code requires privileged execution, remove or restore:

```javascript
pref("general.config.sandbox_enabled", false);
```

The normal secure setting is:

```javascript
pref("general.config.sandbox_enabled", true);
```

Restart Firefox after removal.

Uninstalling won't change the enabled or disabled state of any other extensions.

## Security

Extension Switchboard isn't a normal WebExtension. It runs privileged Firefox code through AutoConfig. (See `README.md` for more information about this, or `SECURITY.md` for a detailed explanation.)

With manual installation, the executable script remains inside the user-writable Firefox profile. Malware or another process running under the same account could potentially replace it and cause modified privileged code to run the next time Firefox starts.

If you're uncomfortable with this kind of potential security risk, use the PowerShell installer, verify the release checksums and review all privileged files before installation.
