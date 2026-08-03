# Troubleshooting

## Firefox fails to start after installation

Likely causes include an AutoConfig syntax error, incorrect file contents, conflicting existing AutoConfig files, or invalid line endings.

Recovery:

1. Close all Firefox processes.
2. Temporarily rename or remove:

   ```text
   <Firefox installation>/firefox.cfg
   <Firefox installation>/defaults/pref/autoconfig.js
   ```

3. Start Firefox.
4. Recheck the packaged files and installation paths before reinstalling.

Confirm that:

- `firefox.cfg` begins with a comment.
- `autoconfig.js` begins with a comment.
- `autoconfig.js` uses LF line endings.
- `general.config.filename` matches the actual configuration filename.
- Existing AutoConfig customizations were merged rather than accidentally overwritten.

## Toolbar button is missing

Check the following:

1. The active profile was identified through `about:support`.
2. The script exists at:

   ```text
   <active profile>/chrome/ExtensionSwitchboard.uc.js
   ```

3. Firefox was completely restarted.
4. The button isn't simply in the customization palette. Open **Customize Toolbar** and search for **Extension Switchboard**.
5. The AutoConfig files are in the Firefox installation used by the current executable.

Open the Browser Console with `Ctrl+Shift+J` and look for messages beginning:

```text
Extension Switchboard loader:
```

or:

```text
Extension Switchboard:
```

## Toolbar button appears but does nothing

Open the Browser Console and inspect the first Extension Switchboard error.

Current releases intentionally resolve the browser window through:

```javascript
event.target.ownerDocument.defaultView
```

with fallbacks. Older builds that used `ownerGlobal` could create the button but fail when it was clicked.

Replace the profile script with the latest release and completely restart Firefox.

## Prompt-service startup error

Current releases use:

```javascript
window.Services?.prompt
```

Do not replace this with the obsolete direct XPCOM prompt-service lookup:

```javascript
Cc["@mozilla.org/embedcomp/prompt-service;1"]
```

A startup error near prompt-service initialization usually indicates an older or regressed script version.

## Categories are not saved

Category changes are saved to:

```text
extensionSwitchboard.config
```

Check the Browser Console for preference-write errors.

Also verify that:

- The profile is writable.
- Firefox isn't being run under a profile mounted read-only.
- Enterprise policies are not preventing preference changes.

If the stored value is malformed, export any recoverable configuration, reset the preference in `about:config`, and rebuild or re-import the categories.

## An extension cannot be enabled or disabled

The row may be unavailable because Firefox has disabled the extension or doesn't grant the necessary enable/disable permission.

Common reasons:

- The extension is incompatible.
- Firefox has disabled it for safety or policy reasons.
- The add-on is no longer installed.
- The add-on state changed after the panel opened.
- Firefox doesn't permit toggling that particular add-on.

Failed operations remain visibly pending, and the operation-details section reports the affected extension and error.

## Enabling an extension doesn't affect the current page

Many content scripts are injected only when a page loads. Enabling an extension may not inject it retroactively into an already-open page. Similarly, disabling an extension may leave prior page modifications visible until reload.

Use **Apply and reload tab**, or reload the page manually.

## Reset did not remove my category changes

This is expected. Reset rereads live extension enabled/disabled states. Category CRUD and assignments save immediately and are not pending Apply operations.

Use category controls to reverse those changes, or import a previous exported configuration.

## Undo is unavailable after restart

This is expected. Undo is a one-level, in-memory extension-state snapshot for the current browser window. It isn't persisted across window closure or Firefox restart.

## Import replaces existing categories

This is expected and deliberate. Import doesn't merge.

The confirmation dialog states how many categories and assignments will replace the current configuration. Extension enabled/disabled states are not changed by import.

## Import is rejected

The importer validates the whole configuration. It rejects invalid JSON, unsupported future versions, duplicate category names or IDs, reserved names, and assignments referencing missing categories.

Use an unmodified file created by the Export button when possible.

## Site-access classification looks incomplete

The switchboard summarizes permission metadata Firefox exposes. It doesn't inspect every script, dynamic permission request, or runtime action.

A label such as **All sites** indicates declared persistent access, not proof that the extension is currently executing on all sites. **Site access unavailable** means Firefox did not expose enough metadata to classify it.

## Firefox update or reinstall removed the switchboard

The profile script normally remains with the profile, but installation-level AutoConfig files may need to be restored after a reinstall or packaging change.

Verify:

```text
<Firefox installation>/firefox.cfg
<Firefox installation>/defaults/pref/autoconfig.js
```

Do not overwrite unrelated AutoConfig content when restoring them.

## Return to a known-working version

1. Export the current category configuration if the panel opens.
2. Close Firefox completely.
3. Replace `ExtensionSwitchboard.uc.js` with the previous release.
4. Restart Firefox.
5. Check the Browser Console before making further changes.
