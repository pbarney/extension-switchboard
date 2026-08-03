/*
run this in the browser console (Ctrl+Shift+J)
*/
const { AddonManager } = ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs"
);

async function setExtensionEnabled(index, enabled) {
    const listedAddon = extensionInventory[index];

    if (!listedAddon) {
        throw new RangeError(`No extension exists at index ${index}.`);
    }

    // Retrieve a fresh Addon object in case the inventory is stale.
    const addon = await AddonManager.getAddonByID(listedAddon.id);

    if (!addon) {
        throw new Error(`Extension no longer found: ${listedAddon.name}`);
    }

    const action = enabled ? "enable" : "disable";

    console.log(
        `${action === "enable" ? "Enabling" : "Disabling"} ` +
        `"${addon.name}" (${addon.id})...`
    );

    if (enabled) {
        if (addon.appDisabled) {
            throw new Error(
                `"${addon.name}" is disabled by Firefox and cannot be enabled normally.`
            );
        }

        await addon.enable();
    } else {
        await addon.disable();
    }

    const updatedAddon = await AddonManager.getAddonByID(addon.id);

    const result = {
        index,
        name: updatedAddon.name,
        active: updatedAddon.isActive,
        userDisabled: updatedAddon.userDisabled,
        appDisabled: updatedAddon.appDisabled,
        id: updatedAddon.id
    };

    console.table([result]);
    return result;
}

async function disableExtension(index) {
    return setExtensionEnabled(index, false);
}

async function enableExtension(index) {
    return setExtensionEnabled(index, true);
}