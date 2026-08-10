# Security and trust model

Extension Switchboard **is *not* an ordinary Firefox WebExtension**. It is an advanced Firefox customization that doesn't run inside the normal WebExtension security model.

Normally, an extension or add-on can't manage other extensions, or even see them. To see and enable/disable them, Extension Switchboard uses **Firefox's AutoConfig** startup mechanism to load a privileged browser-chrome script, which requires disabling Firefox's AutoConfig sandbox:

```javascript
pref("general.config.sandbox_enabled", false);
```

This method is well-established within the Firefox userChromeJS and advanced-customization community, but it's uncommon among Firefox users in general, and isn't the same as installing a normal add-on from Mozilla Add-ons. So before you install it, you should understand the security implication that comes with it.

Disabling the AutoConfig sandbox allows the configured startup code to use Firefox's internal browser privileges. It **does not** disable Firefox's normal web-content sandbox, site isolation, tracking protection, or WebExtension restrictions.

**However:**

## Secure installation model

This script uses a unique (as far as I can tell) approach to security. Most userChrome scripts leave a security hole by keeping the userscript in a location than any normal process can modify; anyone using your computer could modify the file that could open you to serious security risks.

The secure installer for this extension **eliminates that risk** by moving the executable script out of the user-writable Firefox profile and instead storing it in a privileged-access area that can't normally be modified by your user account.

The loading order is like this:

1. `<Firefox installation>/defaults/pref/autoconfig.js`
2. `<Firefox installation>/firefox.cfg`
3. `%ProgramData%/ExtensionSwitchboard/Profiles/<profile>/ExtensionSwitchboard.uc.js`

It's that last file that normally creates the risk, but by using elevated permissions in a non-user-writeable directory, those risks are greatly minimized.

### Here are the technical details for how that works:

- The installer requires administrator elevation
- installs a loader for one exact Firefox profile and one exact script path
- stores the privileged script under `%ProgramData%`
- disables ACL inheritance on the protected directories and script
- gives `Administrators` and `SYSTEM` full control
- gives the selected Firefox user read-and-execute access only
- removes the older user-writable profile copy after backing it up
- backs up existing AutoConfig and Switchboard files
- verifies that the installed script matches the source file

Firefox should then be run normally, without elevation.

This puts to script behind the Windows administrator wall. Ordinary scripts running under your non-elevated login should not be able to modify, delete, replace, rename, or change permissions on the installed script.

**This secure installation substantially mitigates the risk that malware could replace a profile script and gain privileged Firefox execution on restart.**

## What risk remains

If your administrator account is compromised or if you approve a malicious UAC elevation request, an attacker could modify Firefox or its installation files. But this could happen with or without this script being installed, so as usual, be aware of what you're installing out there.

## Scope of privileged access

You should still be aware of what any Privileged Firefox script can potentially do, though:

- modify Firefox's interface and preferences
- inspect or control browser windows and tabs
- manage installed extensions
- access browser and profile information through internal services
- read or write files available to the Firefox process

Extension Switchboard uses only a limited subset of these capabilities. Its source is plain text, it doesn't download executable code, and it doesn't contain any telemetry or online account integration. Category configuration stays local in the Firefox profile, and exported configs only contain category names and extension IDs, not any browsing data or privileged credentials.

So the safety of this extension should be fairly easy for any competent programmer to recognize.

## Recommended precautions

- Install releases only from a trusted source, preferably the project's GitHub repository:
  <https://github.com/pbarney/extension-switchboard>
- Verify published checksums before elevation.
- Review `autoconfig.js`, `firefox.cfg`, the installer, and `ExtensionSwitchboard.uc.js`.
- Don't run Firefox as administrator.
- Don't add unrelated or untrusted scripts to the privileged loader.
- Keep Firefox, Windows, and Extension Switchboard updated.
- Keep a known-working release and the installer-created backups for rollback.
- A standard Windows account using separate administrator credentials provides a stronger boundary than routinely using an administrator account.

## Unsupported and potentially fragile aspects

Mozilla documents AutoConfig primarily for administrative preference management. Using it to load privileged browser-interface code goes beyond that ordinary use.

Extension Switchboard depends on internal Firefox modules and UI behavior that don't receive the compatibility guarantees of the WebExtension API. A Firefox update may require maintenance or could eventually remove the required capability.

## Uninstalling and restoring the sandbox

Use the secure installer's uninstall action while Firefox is closed:

```powershell
.\Install-ExtensionSwitchboard.ps1 -Action Uninstall
```

The uninstall process removes the protected profile-specific script and the managed Extension Switchboard loader block. Review the remaining AutoConfig files before removing them, because another customization may share them.

When no remaining AutoConfig code requires privileged execution, remove this preference or restore it to `true`:

```javascript
pref("general.config.sandbox_enabled", false);
```

Removing Extension Switchboard doesn't revert extension enabled states. Categories and assignments can be removed separately by resetting:

```text
extensionSwitchboard.config
```

## Further reading

- [Mozilla Support: Customizing Firefox using AutoConfig](https://support.mozilla.org/en-US/kb/customizing-firefox-using-autoconfig)
- [userChrome.org: What is AutoConfig startup scripting?](https://www.userchrome.org/what-is-userchrome-js.html)
- [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig)
- [firefox-scripts](https://github.com/xiaoxiaoflood/firefox-scripts)
