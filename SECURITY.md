# Security and trust model

Extension Switchboard is an advanced Firefox customization. It is **not an ordinary Firefox WebExtension** and does not run inside the normal WebExtension security model.

To manage other extensions, it uses Firefox's AutoConfig startup mechanism to load a privileged browser-chrome script. This requires disabling Firefox's **AutoConfig sandbox**.

That design makes Extension Switchboard possible, but it also creates a meaningful trust decision. Read this document before installing it.

## Plain-language summary

Installing Extension Switchboard means allowing a local JavaScript file to run with Firefox's internal browser privileges whenever Firefox starts.

The supplied code is plain text, does not download or execute remote code, and can be inspected before installation. Nevertheless, privileged code can potentially access and alter sensitive parts of Firefox. You should install it only if you trust the files and understand the implications.

This approach is established within the relatively small Firefox userChromeJS and advanced-customization community. It is uncommon among Firefox users generally and is not equivalent to installing a normal add-on from Mozilla Add-ons.

## Why an ordinary extension cannot do this

Firefox deliberately prevents one ordinary WebExtension from freely enabling or disabling other ordinary WebExtensions. That restriction protects users from one extension silently taking control of the rest of their add-ons.

Extension Switchboard's defining function is to enumerate installed extensions and change their enabled state. To do that, it uses Firefox's internal `AddonManager` API from the privileged browser context.

That capability is unavailable to ordinary webpage scripts and ordinary WebExtensions.

## What AutoConfig is

AutoConfig is a Firefox startup mechanism designed primarily for administrators and organizations. It can set, clear, or lock Firefox preferences by loading a configuration file when Firefox starts.

A typical preference-only AutoConfig installation uses functions such as:

```javascript
pref("example.preference", true);
lockPref("another.preference", false);
```

Firefox normally executes AutoConfig code inside a restricted sandbox. That sandbox limits the configuration script largely to the documented preference-management API.

## Why the AutoConfig sandbox is disabled

Extension Switchboard's `firefox.cfg` is not limited to setting preferences. It must:

- observe Firefox browser-window startup;
- locate the active profile's `chrome` directory;
- load `ExtensionSwitchboard.uc.js` into each browser window;
- allow that script to import internal Firefox modules;
- register a toolbar control; and
- use Firefox's internal add-on manager.

Those operations are blocked by the normal AutoConfig sandbox.

The installation therefore sets:

```javascript
pref("general.config.sandbox_enabled", false);
```

This causes `firefox.cfg` to run with Firefox system privileges rather than within the restricted AutoConfig environment.

Disabling the sandbox does not itself search for or execute every script in the profile. The supplied `firefox.cfg` explicitly loads only the named Extension Switchboard profile script. However, any additional code deliberately added to that privileged loading path would receive the same level of access.

## What privileged code could potentially do

A privileged Firefox startup script can potentially:

- modify Firefox's user interface;
- read or change browser preferences;
- inspect and control browser windows and tabs;
- manage installed extensions;
- access sensitive browser or profile information through internal services;
- read or write files available to the user's operating-system account;
- execute automatically whenever Firefox starts.

Extension Switchboard uses only a subset of those capabilities, but the privilege boundary applies to the code as a whole. A maliciously modified copy could do much more than the legitimate project does.

## What disabling this sandbox does not do

Setting `general.config.sandbox_enabled` to `false` does **not** by itself:

- disable Firefox's web-content process sandbox;
- disable site isolation;
- give ordinary websites browser privileges;
- give ordinary WebExtensions unrestricted local-system access;
- make remote websites able to edit the AutoConfig files;
- expose the Browser Console remotely;
- disable Firefox's tracking protection or other browsing protections.

The increased risk is local: trusted or untrusted code placed in the privileged AutoConfig loading path can execute with browser-level authority.

## Trust boundaries

The relevant trust boundary includes at least these files:

```text
<Firefox installation>/defaults/pref/autoconfig.js
<Firefox installation>/firefox.cfg
<Firefox profile>/chrome/ExtensionSwitchboard.uc.js
```

The installation-level files normally require administrator permission to modify. The profile-level script is usually writable by software running under the same operating-system account as the user.

This distinction matters. A malicious program that is already running as your user may be able to replace the profile script without obtaining administrator rights, causing the altered code to run with Firefox privileges at the next startup.

That does not mean Extension Switchboard creates the original malware infection. It means the privileged loader could become a persistence or browser-injection mechanism if the local account is already compromised.

## Project safeguards

The release is designed to reduce avoidable trust and supply-chain risks:

- The bootstrap and main script are plain-text files that can be inspected.
- The supplied loader does not fetch code from the internet.
- Extension Switchboard does not require an online account.
- The project does not intentionally include telemetry or analytics.
- Configuration is stored locally in the Firefox profile.
- Exported category configuration contains category names and extension IDs, not browsing history or passwords.
- Release packages include checksums so downloaded files can be verified.
- Uninstall instructions are provided.

These safeguards improve transparency, but they do not turn the script into a sandboxed or least-privileged extension.

## Is this technique common?

The technique is best described as **established but niche**.

AutoConfig-based userChromeJS loaders have been used for years by Firefox power users who want browser-interface or internal behavior changes that ordinary WebExtensions cannot perform. Within that community, the mechanism is recognizable.

Among Firefox users generally, it is rare. Most users have never edited files in the Firefox installation directory, disabled an AutoConfig restriction, or installed a privileged browser script. Many ordinary users and security-conscious users will reasonably be cautious about doing so.

The project should therefore be presented as:

> An advanced Firefox customization for users who are comfortable reviewing and running privileged local browser code.

It should not be presented as having the same security boundaries, review process, or ease of installation as an add-on distributed through Mozilla Add-ons.

## Unsupported and potentially fragile aspects

Mozilla documents AutoConfig primarily as an administrative preference-management system. Using it as a general privileged customization loader goes beyond that normal use.

Extension Switchboard depends on internal Firefox modules and browser UI behavior. Internal APIs can change without the compatibility guarantees provided to WebExtensions. A future Firefox update could require code changes or could remove the ability to disable the AutoConfig sandbox.

For this reason:

- review release notes before upgrading;
- keep a known-working previous script;
- test after Firefox updates;
- expect occasional maintenance;
- do not assume indefinite compatibility.

## Recommended precautions

Before installing:

1. Read `firefox.cfg`, `autoconfig.js`, and `ExtensionSwitchboard.uc.js`.
2. Download releases only from a source you trust.
3. Verify published checksums when available.
4. Back up existing AutoConfig and profile customization files.
5. Do not overwrite an existing `firefox.cfg` blindly; it may load other privileged customizations.
6. Avoid combining the loader casually with unrelated `.uc.js` scripts from unknown sources.
7. Keep Firefox and the operating system updated.
8. Protect the local user account from untrusted software and other users.
9. Export the switchboard configuration before upgrades.
10. Retain the previous known-working release for rollback.

## When you should not install it

Do not install Extension Switchboard if:

- you are not comfortable allowing reviewed local JavaScript to run with Firefox browser privileges;
- you cannot inspect or trust the supplied files;
- the computer is shared with untrusted users who can modify your profile;
- organizational policy prohibits AutoConfig changes or privileged browser customizations;
- the Firefox installation is centrally managed and you do not control its configuration;
- you require the security and compatibility guarantees of a normal WebExtension;
- you are unwilling to perform maintenance if a Firefox update breaks an internal API.

## Uninstalling and restoring the normal AutoConfig sandbox

To remove Extension Switchboard:

1. Exit Firefox completely.
2. Remove the Extension Switchboard profile script.
3. Remove the Extension Switchboard loader from `firefox.cfg`.
4. Remove the supplied `firefox.cfg` and `autoconfig.js` only if they are not shared with other AutoConfig customizations.
5. Restart Firefox.

If no remaining AutoConfig code requires privileged execution, remove this line or restore it to `true`:

```javascript
pref("general.config.sandbox_enabled", false);
```

The normal default is for the AutoConfig sandbox to remain enabled.

Removing the switchboard does not automatically re-enable or disable extensions. Their current Firefox states remain as they were when the tool was last used. Saved categories and assignments can be removed separately by resetting the `extensionSwitchboard.config` preference.

## Informed-consent checklist

Before proceeding, you should be able to answer **yes** to all of these:

- I understand that this is not an ordinary WebExtension.
- I understand that it runs privileged code during Firefox startup.
- I understand why the AutoConfig sandbox must be disabled for this design.
- I have reviewed or trust the supplied source files.
- I understand that a maliciously modified profile script could misuse these privileges.
- I know how to uninstall the loader and restore the sandbox.
- I accept that future Firefox updates may require maintenance.

If any answer is no, do not install the project until the concern is resolved.

## Further reading

- [Mozilla Support: Customizing Firefox using AutoConfig](https://support.mozilla.org/en-US/kb/customizing-firefox-using-autoconfig)
- [userChrome.org: What is AutoConfig startup scripting?](https://www.userchrome.org/what-is-userchrome-js.html)
- [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig)
- [firefox-scripts](https://github.com/xiaoxiaoflood/firefox-scripts)
