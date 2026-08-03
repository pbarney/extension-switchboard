# Extension Switchboard 0.7.0-rc.1 release notes

Version 0.7.0-rc.1 is the first release candidate for Extension Switchboard 0.7.0. It builds on the v0.6.0 architectural refactor with extension icons, category reordering, interface refinements, and improved keyboard behavior.

## Main changes

* Display each extension’s preferred icon in the extension list.
* Use Firefox’s built-in generic extension icon when an extension doesn't provide a usable icon.
* Allow user-created categories to be reordered by dragging their handles.
* Persist category order alongside existing category and assignment configuration.
* Automatically scroll the category list while dragging near its upper or lower edge.
* Display the installed Extension Switchboard version in the panel heading.
* Emphasize extension site-access labels for easier scanning.
* Improve panel focus handling so Escape closes the switchboard more consistently.
* Refine category-row, extension-row, toolbar, and summary styling.
* Preserve bold status and access labels when extension rows are refreshed.

## Upgrade

Replace only:

```text
<Firefox profile>/chrome/ExtensionSwitchboard.uc.js
```

Then completely restart Firefox.

No changes are required to `firefox.cfg` or `autoconfig.js` when upgrading from an earlier persistent release unless those files are missing or damaged.

## Compatibility

The following remain unchanged:

* Preference: `extensionSwitchboard.config`
* Configuration schema: `1`
* Export format: `extension-switchboard-config`
* Export version: `1`
* Existing categories and assignments
* Import replacement behavior
* One-level in-memory Undo behavior

Existing configuration files remain compatible. Category order is stored using the existing order of entries in the `categories` array.

## Release-candidate status

This release candidate is intended for final installation, upgrade, persistence, and normal-use testing before the final v0.7.0 tag.

Please verify:

* Extension icons and fallback icons
* Category drag-and-drop ordering
* Category-order persistence after restarting Firefox
* Category CRUD and extension assignments
* Apply, Apply and reload, and Undo
* Import and export
* Escape-key behavior
* Upgrade from v0.6.0

## Known limitations

* This is an unofficial privileged Firefox customization.
* Firefox internal API changes may require future maintenance.
* Category and extension-state changes aren't synchronized between simultaneously open switchboard panels in separate Firefox windows.
* Site-access labels summarize reported permissions and aren't runtime activity monitors.
* Undo history exists only in memory and is cleared when Firefox or the browser window closes.
