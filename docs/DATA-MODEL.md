# Data model and Configuration Storage

## Authoritative storage

Extension Switchboard stores its live category configuration in the current Firefox profile (`about:config`) as a string preference:

```text
extensionSwitchboard.config
```

Firefox persists user preferences in the profile. The switchboard reads and writes the preference through Firefox's preference service. While this is stored in `prefs.js`, it's best not to manually edit this file while Firefox is running.

## What is stored

The config contains:

- schema version
- User-created categories
- Extension-ID-to-category assignments

It does **not** store extension enabled/disabled states. Firefox remains authoritative for those states.

The built-in **Uncategorized** category is implicit and isn't stored as a user category. An extension is Uncategorized when it has no valid stored assignment.

## Internal preference schema

Example:

```json
{
  "schemaVersion": 1,
  "categories": [
    {
      "id": "category-550e8400-e29b-41d4-a716-446655440000",
      "name": "Privacy"
    },
    {
      "id": "category-6f9be0d4-2053-4509-a282-38d64d8c5ef5",
      "name": "Development"
    }
  ],
  "assignments": {
    "example-addon@example.org": "category-550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### `schemaVersion`

Current value: `1`.

A future configuration with a schema version greater than the installed switchboard supports is rejected during import.

### `categories`

An array of user-created categories:

```json
{
  "id": "category-...",
  "name": "Category name"
}
```

Rules:

- IDs must be nonempty and unique.
- Names must be nonempty and unique, case-insensitively.
- Names are limited to 80 characters.
- `__uncategorized__` is reserved for the built-in category.
- A user category can't be named `Uncategorized`.

### `assignments`

An object whose keys are Firefox extension IDs and whose values are stored category IDs.

Each extension can have at most one assignment. Assigning an extension to Uncategorized removes its assignment entry.

Assignments referencing a missing category are considered orphaned and are not accepted during import.

## Saving behavior

The following changes save immediately:

- Creating a category
- Renaming a category
- Deleting a category
- Assigning an extension to a category

Deleting a category removes all of the extensions that are assigned to it. They will then appear under "Uncategorized".

Extension checkbox and category-toggle changes are separate pending state changes. They affect Firefox only after **Apply changes** or **Apply and reload tab**.

## Reset and Undo

### Reset

**Reset** rereads the current live enabled/disabled state from Firefox and discards unapplied extension-state selections.

It doesn't undo category creation, deletion, renaming, or assignment changes.

### Undo last apply

Undo stores one in-memory snapshot of extension states successfully changed by the most recent Apply operation.

- It isn't written to the configuration preference
- It isn't included in exports
- It's lost when the browser window closes or Firefox restarts
- Partial undo failures remain available for retry

## Export format

Export creates a dated JSON file such as:

```text
ExtensionSwitchboard-2026-07-29.json
```

The file wraps the internal configuration with format metadata:

```json
{
  "format": "extension-switchboard-config",
  "exportVersion": 1,
  "exportedAt": "2026-07-29T22:00:00.000Z",
  "config": {
    "schemaVersion": 1,
    "categories": [],
    "assignments": {}
  }
}
```

### Export fields

- `format`: must be `extension-switchboard-config`.
- `exportVersion`: current value `1`.
- `exportedAt`: ISO 8601 timestamp.
- `config`: category configuration described above.

The importer also accepts an unwrapped internal configuration object containing `categories` and `assignments`, but the wrapped export format is preferred.

## Import behavior

Import is deliberately **replace**, not merge.

After confirmation, it replaces:

- All current user-created categories.
- All current extension assignments.

It doesn't change:

- Which extensions are enabled or disabled.
- Firefox-disabled or incompatible extension state.
- One-level Undo state for extension toggles.

Import will be rejected for:

- Invalid JSON.
- Unknown wrapped formats.
- Export versions newer than supported.
- Schema versions newer than supported.
- Duplicate category IDs.
- Duplicate category names.
- Empty or reserved category data.
- Orphan assignments.

The current configuration is restored if the imported configuration can't be saved.

## Moving configuration between profiles

Use `Export` in the source profile and `Import` in the destination profile.

Assignments use extension IDs. If an assigned extension isn't installed in the destination profile, the assignment remains in the configuration but has no visible row until an extension with that ID is present. Import itself doesn't install extensions.

This allows you to import your categories before you're done reloading your extensions.

## Manual backup

The preferred backup is the Export button. A complete Firefox profile backup also preserves the preference, but copying or editing only `prefs.js` isn't recommended as a configuration-management method.
