# Extension Switchboard

Extension Switchboard is a privileged Firefox chrome script that provides a central interface for enabling, disabling, categorizing, importing, and exporting installed Firefox extensions.

It is **not a Firefox extension**. It is loaded into Firefox's browser interface by an AutoConfig bootstrap and uses Firefox's internal add-on management APIs.

## Status

Current release: **0.7.0-rc.1**

This is an unofficial Firefox customization. It depends on internal Firefox APIs and may require maintenance after Firefox updates.

## Features

- Displays your Firefox extensions.
- Allows you to enable or disable them individually
- Assign your extensions to user-defined categories.
- Toggle an entire category to enable or disable all extensions in the category.
- Filter in and sorting.
- Summarizes access privileges of each extension.
- Applies changes in batches and reports individual failures.
- Optionally reload the current tab after applying changes.
- One-level Undo for the most recent changes.
- Export and import categories and assignments.
- Stores your configuration in the current Firefox profile (`about:config`).

## What categories do

Categories are user-defined organizational groups and each extension belongs to exactly one category. Extensions that aren't assigned to a category appear in the built-in **Uncategorized** category.

A category checkbox shows and sets the desired state of the extensions in the category:

- Checked: all extensions are selected to be enabled.
- Unchecked: all extensions are selected to be disabled.
- Indeterminate: some extensions are selected to be enabled and others disabled.

Individual extension selections can still be changed after toggling a category.

## Installation

See [docs/INSTALLATION.md](INSTALLATION.md) for complete installation, upgrade, rollback, and removal instructions.

In outline:

1. Copy `profile/chrome/ExtensionSwitchboard.uc.js` into the active Firefox profile's `chrome` directory.
2. Copy `firefox-installation/firefox.cfg` to the top level of the Firefox installation directory.
3. Copy `firefox-installation/defaults/pref/autoconfig.js` into the installation's `defaults/pref` directory.
4. Completely exit and restart Firefox.

## Basic use

1. Click the **Extension Switchboard** toolbar button.
2. Create categories with **New**.
3. Assign extensions using each row's category dropdown.
4. Toggle categories or individual extensions.
5. Drag a user-created category by its handle to change the category order.
6. Click **Apply changes**, or **Apply and reload tab** when page-level scripts may need a reload.

Category names and assignments are saved immediately. Extension enabled/disabled selections do not take effect until Apply is clicked.

**Reset** rereads the current live extension states and discards unapplied extension-state selections. It doesn't remove categories or assignments.

## Configuration and import/export

The live category configuration is stored in the profile preference:

```text
extensionSwitchboard.config
```

See [docs/CONFIGURATION.md](CONFIGURATION.md) for the schema and persistence details.

Import replaces the current categories and assignments. It doesn't merge them and doesn't change which extensions are enabled or disabled.

## Site-access labels

Site-access labels summarize permissions Firefox reports for the extension. They describe declared access, not necessarily whether the extension is actively doing work on a particular page.

- **All sites**: persistent access to all ordinary websites.
- **Limited sites**: persistent access to selected sites or URL patterns.
- **On demand**: temporary access after user interaction, usually through `activeTab`.
- **No site access**: no reported persistent or on-demand website-content access.
- **Site access unavailable**: Firefox did not expose sufficient permission metadata.

## Security

The included AutoConfig setup disables Firefox's AutoConfig sandbox so that the bootstrap can load privileged browser code:

```javascript
pref("general.config.sandbox_enabled", false);
```

This grants `firefox.cfg` and the loaded profile script substantial access to Firefox. Install only code you trust, keep the installation-level files protected from untrusted modification, and review changes before upgrading.

## Compatibility

The release was developed and tested against contemporary desktop Firefox builds. It uses internal Firefox modules and isn't guaranteed to work indefinitely.

The following compatibility paths are intentional and should not be casually replaced:

- `window.Services?.prompt` for prompt, alert, and confirmation services.
- `event.target.ownerDocument.defaultView` and fallbacks for toolbar-window resolution.
- `createElementNS()` for HTML elements inside Firefox's XUL browser document.
- The current `AddonManager.sys.mjs` and `CustomizableUI.sys.mjs` module locations.

Packaged or sandboxed Firefox distributions may not expose writable installation directories in the same way as a standard desktop installation.

## Troubleshooting and testing

- [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- [docs/TESTING.md](TESTING.md)
- [CHANGELOG.md](CHANGELOG.md)

## License

MIT. See [LICENSE](LICENSE).

## Firefox references

- Mozilla AutoConfig documentation: https://support.mozilla.org/en-US/kb/customizing-firefox-using-autoconfig
- Firefox profile locations: https://support.mozilla.org/en-US/kb/profiles-where-firefox-stores-user-data
- CustomizableUI source documentation: https://firefox-source-docs.mozilla.org/browser/components/customizableui/docs/customizableui.html
- AddonManager source documentation: https://firefox-source-docs.mozilla.org/toolkit/mozapps/extensions/addon-manager/AddonManager.html
