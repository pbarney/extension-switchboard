# Changelog

All notable changes to Extension Switchboard are recorded here.

The project follows semantic versioning in spirit. Pre-1.0 releases may still change internal APIs or installation details.

## 0.7.0-rc.1

v0.7.0 - 2026-07-30 - Category reorganization

### Added

- Icons and UI Tweaks
    - Display each extension's preferred icon in the extension list.
    - Use Firefox's built-in generic extension icon when an extension doesn't provide a usable icon.
    - Display the installed Extension Switchboard version in the panel heading.

- Categories Reordering
    - Allow user-created categories to be reordered by dragging their handles.
    - Show insertion indicators while dragging categories.
    - Automatically scroll the category list when dragging near its upper or lower edge.
    - Immediate persistence after dropping
    - Automatic rollback if saving fails

### Changed

- UI Updates
    - Updated the extension-row layout to fit extension icons (including 
      responsive icon sizing for narrower windows)
    - Improved labeling order, wording and styling
    - Small UI tweaks for better consistency with Firefox's interface
    - Adjusted category-row spacing and layout to accommodate drag handles.
    - Unavailable extensions are now always shown, and the previous visibility 
      control is hidden as most users won't have unavailable extensions, and
      those that do should probably know about them.

- Fixed
    - Improved panel focus handling so keyboard interaction, including closing 
      with Escape, behaves consistently.

## 0.6.0

### New

- One-level undo state

### Changed

The DOM creation code now uses shared helpers, and the stylesheet is managed as one versioned constant instead of being embedded inside the panel-opening function.

- Refactored the script into distinct internal modules:
    - `FirefoxCompat`
        - Firefox module imports
        - Error reporting
        - Prompt, alert, and confirmation compatibility paths
    - `ConfigStore`
        - Preference loading and saving
        - Configuration sanitization
        - Import validation
        - Export serialization
        - Configuration cloning
    - `CategoryManager`
        - Category CRUD
        - Category-name validation
        - Extension assignments
        - Uncategorized handling
    - `ExtensionService`
        - Extension enumeration
        - Enable/disable permission checks
        - Site-access classification
        - State changes and post-operation verification
    - `SwitchboardPanel`
        - DOM construction
        - Rendering and filtering
        - Event handling
        - Apply, undo, category, import/export, and feedback UI
- Other:
    - `SwitchboardController`
    - Toolbar registration
    - Panel lifetime
    - Consolidated DOM creation helpers.
    - Consolidated and versioned injected styles.
    - Separated persistence, category rules, extension-state operations, UI rendering, and toolbar/panel lifetime.
    - Preserved working Firefox compatibility paths and the existing configuration schema.

## 0.5.0

### Fixed

- Replaced the icon with a three-switch design
- Moved Import and Export controls into the panel header
- Replaced technical user-facing terms such as `firefox-disabled` with clearer enabled/unavailable wording
- Fixed category-list overflow so long category lists scroll above the footer

### Added

- Export categories and assignments as JSON.
- Import configuration with validation and confirmation.
    - Import replaces current categories and assignments rather than merging.
    - Import does not change extension enabled/disabled states.

## 0.4.0

### Added

- Pending-change counts on Apply buttons.
- Apply and reload current tab.
- Per-operation success and failure details.
- Failed operations remain visibly pending.
- One-level Undo for successfully applied extension-state changes.
- Preservation of newer pending selections during Undo.

## 0.3.0

### Fixed

- Routed category deletion through the compatibility confirmation helper.

### Added

- Applied-state row classes:
    - `active`
    - `user-disabled`
    - `firefox-disabled`
- Site-access summaries.
- Extension IDs retained in search and tooltips instead of occupying visible row space.

### Changed

- Removed the redundant visible status column.
- Newly created categories return the view to Uncategorized for assignment workflow.
- Aligned category dropdowns.

## 0.2.0

### Added

- Persistent user-defined categories.
- Create, rename, and delete category operations.
- Exactly one category assignment per extension.
- Built-in Uncategorized category.
- Category-level enable/disable selections.
- Indeterminate state for mixed categories.
- Preference-backed configuration storage.

## 0.1.0

### Added

- Initial persistent AutoConfig-loaded chrome script.
- Customizable Firefox toolbar button.
- Dynamic enumeration of user-installed extensions.
- Search, sorting, and hide/show controls.
- Live enable and disable operations through Firefox's internal AddonManager.

## Browser Console prototypes

Before 0.1.0, the project was validated through a couple temporary, read-only Browser Console inventory scripts. Those prototypes established that the following requirements were possible:

- dynamic enumeration
- batch state changes
- XUL-safe DOM creation
- sorting
- Firefox-disabled handling