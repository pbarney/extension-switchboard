/*
run this in the browser console (Ctrl+Shift+J)
*/
(async () => {
    const { AddonManager } = ChromeUtils.importESModule(
        "resource://gre/modules/AddonManager.sys.mjs"
    );

    const extensions = await AddonManager.getAddonsByTypes(["extension"]);

    const visibleExtensions = extensions
        .filter(extension => !extension.hidden && !extension.isSystem)
        .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, {
                sensitivity: "base"
            })
        );

    // Preserve the actual Addon objects for later commands.
    globalThis.extensionInventory = visibleExtensions;

    const table = visibleExtensions.map((extension, index) => ({
        index,
        name: extension.name,
        active: extension.isActive,
        userDisabled: extension.userDisabled,
        appDisabled: extension.appDisabled,
        version: extension.version,
        id: extension.id
    }));

    console.table(table);

    return {
        count: table.length,
        message:
            "Extension objects are available as globalThis.extensionInventory"
    };
})();