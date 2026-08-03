# Manual release test checklist

Use a disposable or backed-up Firefox profile when testing installation-level changes.

## A. Package and syntax

- [ ] `ExtensionSwitchboard.uc.js` passes a JavaScript syntax check.
- [ ] `firefox.cfg` begins with a comment.
- [ ] `autoconfig.js` begins with a comment.
- [ ] `autoconfig.js` uses LF line endings.
- [ ] ZIP paths match the documented installation paths.
- [ ] SHA-256 checksums match the packaged files.

## B. Fresh installation

- [ ] With Firefox closed, install the three runtime files.
- [ ] Start Firefox without startup errors.
- [ ] Confirm the toolbar button appears.
- [ ] Open Customize Toolbar and confirm the button can be moved.
- [ ] Click the button and confirm the panel opens.
- [ ] Close with the × button.
- [ ] Reopen and close with Escape.

## C. Extension inventory and display

- [ ] Installed non-system extensions appear.
- [ ] Firefox-disabled extensions are unavailable and grouped after toggleable extensions.
- [ ] Show unavailable hides and restores unavailable rows.
- [ ] Name sorting is alphabetical.
- [ ] Enabled-first and Disabled-first sorting work.
- [ ] Search matches extension name.
- [ ] Search matches extension ID.
- [ ] Search matches category name.
- [ ] Site-access labels appear without blocking the panel if metadata is unavailable.

## D. Category CRUD

- [ ] Create a category.
- [ ] After creation, Uncategorized is selected.
- [ ] Duplicate category names are rejected case-insensitively.
- [ ] Empty names are rejected.
- [ ] Names longer than 80 characters are rejected.
- [ ] Rename a category.
- [ ] Delete a category.
- [ ] Extensions from the deleted category return to Uncategorized.
- [ ] Uncategorized cannot be renamed or deleted.
- [ ] Category list scrolls when there are more categories than vertical space.

## E. Assignment persistence

- [ ] Assign several extensions to categories.
- [ ] Close and reopen the panel; assignments remain.
- [ ] Restart Firefox; assignments remain.
- [ ] Assign an extension back to Uncategorized.

## F. Pending extension-state changes

- [ ] Toggle one individual extension.
- [ ] Apply button shows the correct pending count.
- [ ] Reset discards the pending extension-state selection.
- [ ] Toggle an entire category off.
- [ ] Category checkbox becomes checked, unchecked, or indeterminate as appropriate.
- [ ] Override one individual extension after toggling the category.
- [ ] Apply changes and confirm `about:addons` reflects the result.
- [ ] Operation details list enabled and disabled extensions correctly.

Use expendable utility extensions for live toggle tests. Avoid disabling a password manager or other extension needed to complete the test session.

## G. Apply and reload

- [ ] Select a content-script extension for enable or disable.
- [ ] Click Apply and reload tab.
- [ ] Confirm state changes are applied.
- [ ] Confirm the previously selected tab reloads.

## H. Undo

- [ ] Apply two or more changes.
- [ ] Undo button shows the number of reversible changes.
- [ ] Click Undo and confirm prior states are restored.
- [ ] Make a new pending selection after Apply, then Undo; confirm the newer pending selection is preserved.
- [ ] Restart Firefox and confirm Undo history is cleared.

## I. Export/import

- [ ] Export configuration.
- [ ] Confirm the filename includes the current date.
- [ ] Confirm the JSON contains format, exportVersion, exportedAt, and config.
- [ ] Modify categories, then import the export.
- [ ] Confirm the warning states that categories and assignments will be replaced.
- [ ] Confirm import restores the exported categories and assignments.
- [ ] Confirm import does not change extension enabled/disabled states.
- [ ] Confirm invalid JSON is rejected.
- [ ] Confirm a duplicate category name is rejected.
- [ ] Confirm an orphan assignment is rejected.

## J. Failure behavior

- [ ] Leave an unavailable extension locked.
- [ ] Simulate or encounter a failed state change.
- [ ] Confirm the failed row remains pending and visibly marked.
- [ ] Confirm operation details show the extension name and error.
- [ ] Confirm successful changes in the same batch remain applied.

## K. Upgrade and rollback

- [ ] Replace only the profile script with the new version.
- [ ] Restart and confirm existing categories remain.
- [ ] Roll back to the previous script.
- [ ] Restart and confirm the previous version loads.

## L. Optional multiple-window smoke test

Cross-window synchronization is not a supported feature, but the basic loader should work per window.

- [ ] Open a second Firefox window.
- [ ] Confirm its toolbar button opens a panel in that window.
- [ ] Avoid leaving two panels open while making changes.
