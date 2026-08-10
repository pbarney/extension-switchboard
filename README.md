# Extension Switchboard

Extension Switchboard is a privileged Firefox chrome script that provides a central interface for enabling, disabling, categorizing, importing, and exporting installed Firefox extensions.

It is **not a Firefox extension**. It is loaded into Firefox's browser interface through AutoConfig and uses Firefox's internal add-on management APIs.

## Status

Current release: **0.7.0-rc.1**

This is an unofficial Firefox customization. It depends on internal Firefox APIs and may require maintenance after Firefox updates.

## Features

- Displays your installed Firefox extensions.
- Enable or disable extensions individually.
- Organize your extensions into user-defined categories.
- Enable or disable an entire category at once.
- Filter and sort the extension list.
- Summarize each extension's reported access permissions.
- Apply changes in batches and report individual failures.
- Optionally reload the current tab after applying changes.
- Undo the most recently applied changes.
- Export and import categories and assignments.
- Store configuration in the current Firefox profile (`about:config`).

## What categories do

Each extension belongs to exactly one category. Extensions that haven't been assigned appear in the built-in **Uncategorized** category.

A category checkbox controls the state of its extensions:

- **Checked:** all extensions are selected to be enabled.
- **Unchecked:** all extensions are selected to be disabled.
- **Indeterminate:** a mixture of enabled and disabled selections.

Individual extension selections can still be changed after toggling a category.

## Installation

The recommended installation method is the included Windows PowerShell installer.

For a packaged release:

1. Extract the release.
2. Exit Firefox completely.
3. Run `Install-ExtensionSwitchboard.ps1`.
4. Approve the UAC prompt.
5. Restart Firefox.

The installer will detect your Firefox installation and profile, back up any existing AutoConfig files, install the privileged script under `%ProgramData%` (with restricted NTFS permissions), update the Firefox AutoConfig loader, and then verify everything.

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for more detailed installation, upgrade, verification, rollback, uninstall, and repository-development instructions.

A manual installation path is also available under [`installer/manual`](installer/manual/README.md), but it keeps the privileged script in the user-writable Firefox profile resulting in weaker local security.

## Basic use

1. Click the **Extension Switchboard** toolbar button.
2. Create categories with **New**.
3. Assign extensions using each row's category dropdown.
4. Toggle categories or individual extensions.
5. Drag a user-created category by its handle to change category order.
6. Click **Apply changes**, or **Apply and reload tab** when page-level scripts may need a reload.

Category names and assignments are saved immediately. Extension enabled/disabled selections do not take effect until **Apply** is clicked.

**Reset** rereads the current live extension states and discards any unapplied extension-state selections.

## Configuration and import/export

The live category configuration is stored in the Firefox profile preference:

```text
extensionSwitchboard.config
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for the schema and persistence details.

Import replaces the current categories and assignments. It doesn't merge them and doesn't change which extensions are enabled or disabled.

## Site-access labels

Site-access labels summarize permissions Firefox reports for each extension. They describe if access is *declared*, not necessarily whether the extension is actually doing any work on a particular page. (More work may be done in the future to clarify which extensions are actually running in any given tab.)

- **All sites:** persistent access to all ordinary websites.
- **Limited sites:** persistent access to selected sites or URL patterns.
- **On demand:** temporary access after user interaction, usually through `activeTab`.
- **No site access:** no reported persistent or on-demand website-content access.
- **Site access unavailable:** For whatever reason, Firefox isn't exposing sufficient permission metadata.

## Security

Extension Switchboard requires disabling Firefox's AutoConfig sandbox so its loader can run privileged browser code:

```javascript
pref("general.config.sandbox_enabled", false);
```

The recommended installer greatly reduces any tampering risk by storing the main script (`ExtensionSwitchboard.uc.js`) under `%ProgramData%` (typically `C:\ProgramData\ExtensionSwitchboard`) with restricted permissions instead of placing it in the user-writable Firefox profile.

Extension Switchboard is not the same as a normal WebExtension. It still runs with substantial Firefox privileges, so install only trusted releases, verify published checksums, and review changes before upgrading.

See [docs/SECURITY.md](docs/SECURITY.md) for the full trust model.

## Compatibility

Extension Switchboard targets standard desktop Firefox installations on Windows. It uses internal Firefox modules and isn't guaranteed to be compatible with future Firefox releases.

Packaged or sandboxed Firefox distributions may not expose writable installation directories in the same way as a standard desktop installation, so your mileage may vary.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Data Model](docs/DATA-MODEL.md)
- [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Changelog](CHANGELOG.md)
- [Release notes](RELEASE-NOTES.md)

## License

MIT. See [LICENSE](LICENSE).

## Firefox references

- Mozilla AutoConfig documentation: https://support.mozilla.org/en-US/kb/customizing-firefox-using-autoconfig
- Firefox profile locations: https://support.mozilla.org/en-US/kb/profiles-where-firefox-stores-user-data
- CustomizableUI source documentation: https://firefox-source-docs.mozilla.org/browser/components/customizableui/docs/customizableui.html
- AddonManager source documentation: https://firefox-source-docs.mozilla.org/toolkit/mozapps/extensions/addon-manager/AddonManager.html
