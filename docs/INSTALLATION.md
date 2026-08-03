# Installation, upgrade, rollback, and removal

## Important security notice

Extension Switchboard is privileged browser code, not an ordinary WebExtension. The included AutoConfig setup disables Firefox's AutoConfig sandbox to allow Firefox to load the profile script.

**Do not install modified or untrusted copies of these files.** If the Firefox installation directory is writable by untrusted users or software, correct that before using this customization.

## Requirements

- Desktop Firefox.
- Permission to write to the Firefox installation directory (typically `C:\Program Files\Mozilla Firefox\`).
- Permission to write to the active Firefox profile (typically `C:\Users\{username}\AppData\Roaming\Mozilla\Firefox\Profiles\{profile-id}`)
- A complete Firefox restart after installation or upgrade.

Standard Mozilla desktop installations (including Developer Edition) are the primary target. Microsoft Store/MSIX, Snap, Flatpak, and other packaged builds may use different or read-only application locations and aren't covered by these instructions.

## Package layout

```text
ExtensionSwitchboard-v0.6.0-release/
├── profile/
│   └── chrome/
│       └── ExtensionSwitchboard.uc.js
└── firefox-installation/
    ├── firefox.cfg
    └── defaults/
        └── pref/
            └── autoconfig.js
```

## 1. Back up existing customization files

Before copying anything, check whether these files already exist:

```text
<Firefox installation>/firefox.cfg
<Firefox installation>/defaults/pref/autoconfig.js
<Firefox profile>/chrome/ExtensionSwitchboard.uc.js
```

If `firefox.cfg` or `autoconfig.js` already exists, do **not** blindly overwrite it. It may load other customizations or enforce organizational preferences. Back it up and merge the Extension Switchboard bootstrap carefully.

## 2. Find the active profile

The safest method is:

1. Open `about:support` in Firefox.
2. Find **Profile Folder** under Application Basics.
3. Click **Open Folder**.

On a standard Windows installation, profiles are commonly under:

```text
%APPDATA%\Mozilla\Firefox\Profiles\
```

Use the active profile shown by `about:support`, not merely the first profile directory you find.

## 3. Install the profile script

Inside the active profile, create the `chrome` directory if it doesn't already exist:

```text
<Firefox profile>\chrome\
```

Copy:

```text
profile/chrome/ExtensionSwitchboard.uc.js
```

to:

```text
<Firefox profile>\chrome\ExtensionSwitchboard.uc.js
```

The filename must be exact.

## 4. Find the Firefox installation directory

Typical locations:

### Windows

```text
C:\Program Files\Mozilla Firefox\
```

or, for a 32-bit installation:

```text
C:\Program Files (x86)\Mozilla Firefox\
```

The current executable path is also shown on `about:support` under **Application Binary**.

### Linux

The location depends on the distribution and installation method, commonly beneath `/usr/lib/firefox`, `/usr/lib64/firefox`, or the directory containing the Firefox executable.

### macOS

Use the application's resources directory:

```text
Firefox.app/Contents/Resources/
```

## 5. Install the AutoConfig bootstrap

Copy:

```text
firefox-installation/firefox.cfg
```

to the top level of the Firefox installation directory:

```text
<Firefox installation>/firefox.cfg
```

Copy:

```text
firefox-installation/defaults/pref/autoconfig.js
```

to:

```text
<Firefox installation>/defaults/pref/autoconfig.js
```

`autoconfig.js` must retain Unix/LF line endings, including on Windows. The packaged file already uses LF endings.

Both files begin with a comment as required by Firefox AutoConfig.

## 6. Restart Firefox completely

1. Exit all Firefox windows.
2. Verify no Firefox processes remain.
3. Start Firefox again.

A new **Extension Switchboard** button should appear in the navigation toolbar. Because it is registered through Firefox's customizable toolbar system, it can be moved through **Customize Toolbar**.

If the button doesn't appear, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Existing AutoConfig installations

The included `autoconfig.js` contains:

```javascript
pref("general.config.filename", "firefox.cfg");
pref("general.config.obscure_value", 0);
pref("general.config.sandbox_enabled", false);
```

If an existing `autoconfig.js` already identifies a different configuration filename, either retain that filename and merge the loader into the existing configuration file, or deliberately standardize the setup after backing it up.

The included `firefox.cfg` is a loader. It resolves the active profile's `chrome` directory and loads `ExtensionSwitchboard.uc.js` into each browser window after delayed startup.

## Upgrade

For ordinary Extension Switchboard upgrades:

1. Back up the current `ExtensionSwitchboard.uc.js`.
2. Replace it with the newer release's profile script.
3. Completely restart Firefox.

The installation-level `firefox.cfg` and `autoconfig.js` normally don't need replacement unless the release notes explicitly say the bootstrap changed.

The v0.6.0 configuration schema remains compatible with prior category-enabled releases.

## Rollback

1. Exit Firefox completely.
2. Replace `ExtensionSwitchboard.uc.js` with the previous known-working version.
3. Restart Firefox.

Category configuration remains in `extensionSwitchboard.config`. Current releases sanitize unsupported or malformed data rather than intentionally deleting the preference.

For extra safety, export the configuration before an upgrade.

## Uninstall

1. Exit Firefox completely.
2. Remove:

   ```text
   <Firefox profile>/chrome/ExtensionSwitchboard.uc.js
   ```

3. Remove `firefox.cfg` and `defaults/pref/autoconfig.js` only if they are used exclusively by Extension Switchboard. If they are shared with other customizations, remove only the Extension Switchboard loader and related preferences.
4. Restart Firefox.

Optional configuration cleanup:

1. Open `about:config`.
2. Search for:

   ```text
   extensionSwitchboard.config
   ```

3. Reset or delete that preference.

Removing the configuration preference deletes saved categories and assignments, but it doesn't change the current enabled/disabled state of extensions.
