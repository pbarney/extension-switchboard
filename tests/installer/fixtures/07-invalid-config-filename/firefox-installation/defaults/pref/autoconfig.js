// Invalid filename test.
pref("general.config.filename", "bad:name.cfg");
pref("general.config.obscure_value", 0);
pref("general.config.sandbox_enabled", true);
const INVALID_FILENAME_MARKER = "MUST-STAY-UNCHANGED";
