# Security and trust model

Extension Switchboard ***not* an ordinary Firefox WebExtension**. It is an advanced Firefox customization and doesn't run inside the normal WebExtension security model.

Normally, and extension/addon is not capable of managing other extensions or even *seeing* them. In order to see them and enable/disable them, Extension Switchboard operates via **Firefox's AutoConfig** startup mechanism to load a privileged browser-chrome script, which requires disabling Firefox's AutoConfig sandbox.

This type of design is what makes Extension Switchboard possible, and is well-established within the Firefox userChromeJS and advanced-customization community, but it *is* uncommon among Firefox users in general and is not equivalent to installing a normal add-on from Mozilla Add-ons. It creates a security implication that you need to understand before you decide to install it.

## In plain language:

Installing Extension Switchboard means allowing a local JavaScript file to run with Firefox's internal browser privileges whenever Firefox starts.

The extension's code doesn't download or execute remote code, and is written in plain text, available for a full security review. Nevertheless, privileged code can potentially access and alter sensitive parts of Firefox. You should install it only if you trust the files and understand the implications.

## Why an ordinary extension can't do this

Firefox deliberately prevents ordinary WebExtensions from freely enabling or disabling other ordinary WebExtensions in order to protect users from one extension silently taking control of the rest of their add-ons, or allowing an extension to fingerprint your device.

Extension Switchboard's defining function is to list installed extensions and change their enabled state. In order to do that, it uses Firefox's internal `AddonManager` API from the privileged browser context, and that particular capability is unavailable to ordinary webpage scripts and ordinary WebExtensions.

## What AutoConfig is

AutoConfig is a Firefox startup mechanism designed primarily for administrators and organizations. It can set, clear, or lock Firefox preferences by loading a configuration file when Firefox starts.

Typically, a preference-only AutoConfig installation looks something like this:

```javascript
pref("example.preference", true);
lockPref("another.preference", false);
```

Normally, Firefox executes AutoConfig code inside of a restricted sandbox. That sandbox limits the configuration script mos;y to the just changing config preferences via the preference-management API.

## Why the AutoConfig sandbox is needs to be disabled

Extension Switchboard's `firefox.cfg` isn't just limited to setting preferences. It also does the following:

- observes Firefox browser-window startup;
- locates the active profile's `chrome` directory;
- loads `ExtensionSwitchboard.uc.js` into each browser window;
- allows that script to use internal Firefox modules;
- registers a toolbar button; and
- uses Firefox's internal add-on manager.

Those operations are normally blocked by the AutoConfig sandbox.

Therefore, the installation sets the following preference:

```javascript
pref("general.config.sandbox_enabled", false);
```

This causes `firefox.cfg` to run with Firefox system privileges rather than within the restricted sandbox.

Disabling the sandbox doesn't itself doesn't *do* anything per se but Extension Switchboard's own `firefox.cfg` explicitly loads only the named Extension Switchboard profile script. However, any additional code that is deliberately added to that privileged loading path would receive the same level of access.

## What privileged code could potentially do

A privileged Firefox startup script can potentially:

- modify Firefox's user interface
- read or change browser preferences
- inspect and control browser windows and tabs
- manage installed extensions
- access sensitive browser or profile information through internal services
- read or write files available to the user's operating-system account
- execute automatically whenever Firefox starts

Extension Switchboard uses only a small subset of those capabilities, but the privilege boundary applies to the code as a whole. A maliciously modified copy could do much more than the legitimate project does.

## What disabling the sandbox doesn't do

Setting `general.config.sandbox_enabled` to `false` does **not** by itself:

- disable Firefox's web-content process sandbox
- disable site isolation
- give ordinary websites browser privileges
- give ordinary WebExtensions unrestricted local-system access
- make remote websites able to edit the AutoConfig files
- expose the Browser Console remotely
- disable Firefox's tracking protection or other browsing protections

The increased risk is not from external websites; it's entirely on your computer: any trusted (or untrusted) code placed in the privileged AutoConfig loading path can execute with browser-level authority. This means that a malicious person could potentially modify Extension Switchboard's code to cause real security issues.

## Trust boundaries

The relevant trust boundary includes at least these files:

```text
<Firefox installation>/defaults/pref/autoconfig.js
<Firefox installation>/firefox.cfg
<Firefox profile>/chrome/ExtensionSwitchboard.uc.js
```

The installation-level files normally require administrator permission to modify. The profile-level script (`ExtensionSwitchboard.uc.js`) usually does not.

That means a malicious program that is already running under your computer login account could potentially replace the profile script without needing administrator rights, causing the altered code to run with Firefox privileges at the next startup. That means if your local login account is already compromised, then a privileged loader could potentially become a browser-injection mechanism.

## Project safeguards

The release is designed to reduce avoidable trust and supply-chain risks:

- The bootstrap and main script are plain-text files that can be inspected
- The supplied loader doesn't fetch code from the internet
- Extension Switchboard doesn't require an online account
- It doesn't include any telemetry or analytics
- Configuration is stored locally in the Firefox profile
- Exported category configuration contains only category names and extension IDs, not any privileged information
- Release packages include checksums so downloaded files can be verified
- Uninstall instructions are provided

These safeguards improve transparency, but they don't entirely eliminate the potential security risk.

## Is this technique common?

The technique is probably best described as **well-established but somewhat niche**.

AutoConfig-based userChromeJS loaders have been used for years by Firefox power users who want browser-interface or internal behavior changes that ordinary WebExtensions can't perform. Within that community, the mechanism is very recognizable.

Among Firefox users, it is rare. Most users have never installed a privileged browser script, and will reasonably be cautious about doing so.

This project is therefore presented as:

> An advanced Firefox customization for users who are comfortable reviewing and running privileged local browser code.

## Unsupported and potentially fragile aspects

Mozilla documents AutoConfig primarily as an administrative preference-management system. Using it as a general privileged customization loader goes beyond that normal use.

Extension Switchboard depends on internal Firefox modules and browser UI behavior. Internal APIs can change without the compatibility guarantees provided to WebExtensions. A future Firefox update could require code changes or could remove the ability to disable the AutoConfig sandbox.

For this reason:

- review release notes before upgrading
- keep a known-working previous script
- test after Firefox updates
- expect occasional maintenance updates
- don't assume it will work indefinitely

## Recommended precautions

Before installing:

1. read `firefox.cfg`, `autoconfig.js`, and `ExtensionSwitchboard.uc.js`
2. download releases only from a source you trust (ideally the github repo at https://github.com/pbarney/extension-switchboard)
3. verify published checksums when available
4. back up existing AutoConfig and profile customization files
5. don't overwrite an existing `firefox.cfg` blindly; it may already load other privileged customizations
6. avoid combining the loader casually with unrelated `.uc.js` scripts from unknown sources
7. keep Firefox and your operating system updated
8. protect your local user account from untrusted software and other users
9. export the switchboard configuration before upgrades
10. retain a previous known-working release for rollback, just in case

## When you shouldn't install it

Don't install Extension Switchboard if:

- if you aren't comfortable allowing reviewed local JavaScript to run with Firefox browser privileges
- if you can't inspect or trust the supplied files
- if the computer is shared with untrusted users who can modify your profile
- if organizational policy prohibits AutoConfig changes or privileged browser customizations
- if the Firefox installation is centrally managed and you don't control its configuration
- if you require the security and compatibility guarantees of a normal WebExtension
- if you are unwilling to perform maintenance if a Firefox update breaks an internal API

## Uninstalling and restoring the normal AutoConfig sandbox

To remove Extension Switchboard:

1. Exit Firefox completely
2. Remove the Extension Switchboard profile script
3. Remove the Extension Switchboard loader from `firefox.cfg`
4. Remove the supplied `firefox.cfg` and `autoconfig.js` only if they aren't shared with other AutoConfig customizations
5. Restart Firefox

The normal default is for the AutoConfig sandbox to remain enabled, so if no remaining AutoConfig code requires privileged execution, remove this line (or restore it to `true`):

```javascript
pref("general.config.sandbox_enabled", false);
```

Removing the switchboard doesn't automatically re-enable or disable extensions. Their current Firefox states remain as they were when the tool was last used. Saved categories and assignments can be removed separately by resetting the `extensionSwitchboard.config` preference.

## Informed-consent checklist

Before proceeding, you should be able to answer **yes** to all of these:

- I understand that this isn't an ordinary WebExtension
- I understand that it runs privileged code during Firefox startup
- I understand why the AutoConfig sandbox must be disabled for this design
- I have reviewed or trust the supplied source files
- I understand that a maliciously modified profile script could misuse these privileges
- I know how to uninstall the loader and restore the sandbox
- I accept that future Firefox updates may require maintenance

If any answer is no, don't install the project until that concern is resolved.

## Further reading

- [Mozilla Support: Customizing Firefox using AutoConfig](https://support.mozilla.org/en-US/kb/customizing-firefox-using-autoconfig)
- [userChrome.org: What is AutoConfig startup scripting?](https://www.userchrome.org/what-is-userchrome-js.html)
- [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig)
- [firefox-scripts](https://github.com/xiaoxiaoflood/firefox-scripts)
