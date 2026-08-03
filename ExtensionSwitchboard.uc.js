/*
 * Extension Switchboard
 * Persistent Firefox chrome script loaded through AutoConfig.
 *
 * v0.1.0 - Proof of concept
 *
 * - straight list of extensions to enable/disable
 * - sorting/filtering
 * - no persistence
 *
 * The toolbar button opens a searchable list of installed extensions.
 * Checked means the extension should be active after Apply.
 */

(() => {
    "use strict";

    const VERSION = "0.1.0";
    const WIDGET_ID = "extension-switchboard-button";
    const PANEL_ID = "extension-switchboard-panel";
    const STYLE_ID = "extension-switchboard-style";
    const HTML_NS = "http://www.w3.org/1999/xhtml";

    if (
        window.ExtensionSwitchboard?.version === VERSION ||
        document.documentElement.getAttribute("windowtype") !== "navigator:browser"
    ) {
        return;
    }

    const { AddonManager } = ChromeUtils.importESModule(
        "resource://gre/modules/AddonManager.sys.mjs"
    );

    const CustomizableUI = window.CustomizableUI ??
        ChromeUtils.importESModule(
            "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
        ).CustomizableUI;

    const reportError = error => {
        const message = error instanceof Error
            ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
            : String(error);

        try {
            Components.utils.reportError(`Extension Switchboard: ${message}`);
        } catch {
            console.error("Extension Switchboard:", error);
        }
    };

    const ensureStyle = () => {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElementNS(HTML_NS, "style");
        style.id = STYLE_ID;
        style.textContent = `
            #${WIDGET_ID} {
                list-style-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cg fill='none' stroke='context-stroke' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M2 4h12M2 8h12M2 12h12'/%3E%3C/g%3E%3Cg fill='context-fill'%3E%3Ccircle cx='5' cy='4' r='2'/%3E%3Ccircle cx='11' cy='8' r='2'/%3E%3Ccircle cx='7' cy='12' r='2'/%3E%3C/g%3E%3C/svg%3E");
                -moz-context-properties: fill, stroke;
                fill: currentColor;
                stroke: currentColor;
            }
            #${PANEL_ID} {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: grid;
                place-items: center;
                background: rgb(0 0 0 / 45%);
                color-scheme: light dark;
                font: message-box;
            }
            #${PANEL_ID} * { box-sizing: border-box; }
            #${PANEL_ID} .sw-panel {
                width: min(700px, calc(100vw - 40px));
                height: min(800px, calc(100vh - 40px));
                display: grid;
                grid-template-rows: auto auto 1fr auto;
                overflow: hidden;
                border: 1px solid GrayText;
                border-radius: 10px;
                background: Canvas;
                color: CanvasText;
                box-shadow: 0 18px 60px rgb(0 0 0 / 45%);
            }
            #${PANEL_ID} .sw-header,
            #${PANEL_ID} .sw-toolbar,
            #${PANEL_ID} .sw-footer { padding: 12px 14px; }
            #${PANEL_ID} .sw-header,
            #${PANEL_ID} .sw-toolbar { border-bottom: 1px solid GrayText; }
            #${PANEL_ID} .sw-footer { border-top: 1px solid GrayText; }
            #${PANEL_ID} .sw-header,
            #${PANEL_ID} .sw-footer {
                display: flex;
                gap: 12px;
                align-items: center;
                justify-content: space-between;
            }
            #${PANEL_ID} h1 { margin: 0; font-size: 18px; }
            #${PANEL_ID} .sw-small { margin-top: 4px; font-size: 12px; opacity: .75; }
            #${PANEL_ID} .sw-toolbar {
                display: flex;
                flex-wrap: wrap;
                gap: 10px 12px;
                align-items: center;
            }
            #${PANEL_ID} input[type="search"] {
                flex: 1 1 320px;
                min-height: 34px;
                padding: 6px 10px;
            }
            #${PANEL_ID} .sw-control {
                display: inline-flex;
                gap: 6px;
                align-items: center;
                font-size: 12px;
                white-space: nowrap;
            }
            #${PANEL_ID} .sw-control select { min-height: 30px; }
            #${PANEL_ID} .sw-list { overflow: auto; padding-block: 5px; }
            #${PANEL_ID} .sw-row {
                display: grid;
                grid-template-columns: 28px minmax(0, 1fr) auto;
                gap: 8px;
                align-items: center;
                min-height: 48px;
                padding: 6px 14px;
            }
            #${PANEL_ID} .sw-row[hidden] { display: none; }
            #${PANEL_ID} .sw-row:hover {
                background: color-mix(in srgb, AccentColor 10%, transparent);
            }
            #${PANEL_ID} .sw-row.changed {
                background: color-mix(in srgb, AccentColor 17%, transparent);
            }
            #${PANEL_ID} .sw-name {
                overflow: hidden;
                font-weight: 600;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${PANEL_ID} .sw-id {
                overflow: hidden;
                margin-top: 2px;
                font: 11px monospace;
                opacity: .6;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${PANEL_ID} .sw-status { font-size: 11px; white-space: nowrap; }
            #${PANEL_ID} .sw-actions { display: flex; gap: 8px; }
            #${PANEL_ID} button {
                min-height: 32px;
                padding: 5px 12px;
                cursor: pointer;
            }
            #${PANEL_ID} button:disabled,
            #${PANEL_ID} input:disabled {
                cursor: not-allowed;
                opacity: .55;
            }
            #${PANEL_ID} .sw-close {
                min-width: 32px;
                padding-inline: 8px;
                font-size: 18px;
            }
        `;

        document.documentElement.append(style);
    };

    const ensureWidget = () => {
        const existingWidget = CustomizableUI.getWidget(WIDGET_ID);

        if (existingWidget?.provider === CustomizableUI.PROVIDER_API) {
            return;
        }

        CustomizableUI.createWidget({
            id: WIDGET_ID,
            type: "button",
            defaultArea: CustomizableUI.AREA_NAVBAR,
            removable: true,
            label: "Extension Switchboard",
            tooltiptext: "Enable or disable Firefox extensions",
            onCommand(event) {

                const win =
                    event?.target?.ownerDocument?.defaultView ??
                    event?.currentTarget?.ownerDocument?.defaultView ??
                    event?.view;

                if (!win?.ExtensionSwitchboard) {
                    reportError(
                        new Error(
                            "Could not locate Extension Switchboard in the " +
                            "browser window that received the command."
                        )
                    );
                    return;
                }

                win.ExtensionSwitchboard.open().catch(reportError);
            }
        });
    };

    const createHtmlElement = (tagName, options = {}) => {
        const element = document.createElementNS(HTML_NS, tagName);

        if (options.className) element.className = options.className;
        if (options.text !== undefined) element.textContent = options.text;

        for (const [name, value] of Object.entries(options.attributes ?? {})) {
            element.setAttribute(name, value);
        }

        return element;
    };

    const close = () => {
        document.getElementById(PANEL_ID)?.remove();
    };

    const open = async () => {
        ensureStyle();
        close();

        const overlay = createHtmlElement("div");
        overlay.id = PANEL_ID;

        const panel = createHtmlElement("div", {
            className: "sw-panel",
            attributes: {
                role: "dialog",
                "aria-label": "Extension Switchboard",
                "aria-modal": "true"
            }
        });

        const header = createHtmlElement("div", { className: "sw-header" });
        const headingGroup = createHtmlElement("div");
        const heading = createHtmlElement("h1", { text: "Extension Switchboard" });
        const summaryElement = createHtmlElement("div", {
            className: "sw-summary sw-small",
            text: "Loading extensions…"
        });
        const closeElement = createHtmlElement("button", {
            className: "sw-close",
            text: "×",
            attributes: {
                type: "button",
                title: "Close",
                "aria-label": "Close"
            }
        });

        headingGroup.append(heading, summaryElement);
        header.append(headingGroup, closeElement);

        const toolbar = createHtmlElement("div", { className: "sw-toolbar" });
        const searchElement = createHtmlElement("input", {
            className: "sw-search",
            attributes: {
                type: "search",
                placeholder: "Filter by extension name or ID…",
                autocomplete: "off"
            }
        });

        const sortLabel = createHtmlElement("label", { className: "sw-control" });
        sortLabel.append(createHtmlElement("span", { text: "Sort:" }));

        const sortElement = createHtmlElement("select", {
            className: "sw-sort",
            attributes: { "aria-label": "Sort extensions" }
        });

        for (const [value, label] of [
            ["name", "Name"],
            ["active-first", "Active first"],
            ["user-disabled-first", "User-disabled first"]
        ]) {
            sortElement.append(createHtmlElement("option", {
                text: label,
                attributes: { value }
            }));
        }
        sortLabel.append(sortElement);

        const showFirefoxDisabledLabel = createHtmlElement("label", {
            className: "sw-control"
        });
        const showFirefoxDisabledElement = createHtmlElement("input", {
            className: "sw-show-firefox-disabled",
            attributes: { type: "checkbox" }
        });
        showFirefoxDisabledElement.checked = true;
        showFirefoxDisabledLabel.append(
            showFirefoxDisabledElement,
            createHtmlElement("span", { text: "Show Firefox-disabled" })
        );

        const shownElement = createHtmlElement("div", {
            className: "sw-shown sw-small"
        });

        toolbar.append(
            searchElement,
            sortLabel,
            showFirefoxDisabledLabel,
            shownElement
        );

        const listElement = createHtmlElement("div", { className: "sw-list" });

        const footer = createHtmlElement("div", { className: "sw-footer" });
        const messageElement = createHtmlElement("div", {
            className: "sw-message sw-small",
            text: "No unapplied changes."
        });
        const actions = createHtmlElement("div", { className: "sw-actions" });
        const resetElement = createHtmlElement("button", {
            className: "sw-reset",
            text: "Reset",
            attributes: { type: "button" }
        });
        const applyElement = createHtmlElement("button", {
            className: "sw-apply",
            text: "Apply changes",
            attributes: { type: "button" }
        });
        applyElement.disabled = true;

        actions.append(resetElement, applyElement);
        footer.append(messageElement, actions);
        panel.append(header, toolbar, listElement, footer);
        overlay.append(panel);
        document.documentElement.append(overlay);

        let busy = false;
        let keepMessage = false;
        const rows = [];

        const getStatus = addon => {
            const states = [];
            if (addon.appDisabled) states.push("Firefox-disabled");
            if (addon.userDisabled) states.push("user-disabled");
            if (addon.softDisabled) states.push("soft-disabled");
            return states.join(" + ") || (addon.isActive ? "active" : "inactive");
        };

        const canToggle = addon => {
            if (addon.appDisabled) return false;

            const permission = addon.isActive
                ? AddonManager.PERM_CAN_DISABLE
                : AddonManager.PERM_CAN_ENABLE;

            return Boolean(addon.permissions & permission);
        };

        const updateCounts = () => {
            const active = rows.filter(row => row.currentActive).length;
            const firefoxDisabled = rows.filter(row => row.appDisabled).length;
            const changed = rows.filter(
                row => row.checkbox.checked !== row.currentActive
            ).length;
            const visible = rows.filter(row => !row.element.hidden).length;

            summaryElement.textContent =
                `${rows.length} extensions · ${active} active · ` +
                `${firefoxDisabled} Firefox-disabled`;
            shownElement.textContent = `${visible} shown`;
            applyElement.disabled = busy || changed === 0;
            applyElement.textContent = changed
                ? `Apply changes (${changed})`
                : "Apply changes";

            if (!busy && changed === 0 && !keepMessage) {
                messageElement.textContent = "No unapplied changes.";
            }
        };

        const updateRow = (row, addon) => {
            row.currentActive = addon.isActive;
            row.currentUserDisabled = addon.userDisabled;
            row.appDisabled = addon.appDisabled;
            row.locked = !canToggle(addon);
            row.checkbox.checked = addon.isActive;
            row.checkbox.disabled = busy || row.locked;
            row.status.textContent = getStatus(addon);
            row.element.classList.remove("changed");
        };

        const setBusy = value => {
            busy = value;
            searchElement.disabled = value;
            sortElement.disabled = value;
            showFirefoxDisabledElement.disabled = value;
            resetElement.disabled = value;
            closeElement.disabled = value;

            for (const row of rows) {
                row.checkbox.disabled = value || row.locked;
            }

            updateCounts();
        };

        const addons = (await AddonManager.getAddonsByTypes(["extension"]))
            .filter(addon => !addon.hidden && !addon.isSystem);

        for (const addon of addons) {
            const rowElement = createHtmlElement("label", { className: "sw-row" });
            const checkbox = createHtmlElement("input", {
                attributes: { type: "checkbox" }
            });
            checkbox.checked = addon.isActive;
            checkbox.disabled = !canToggle(addon);

            const details = createHtmlElement("div");
            const name = createHtmlElement("div", {
                className: "sw-name",
                text: addon.name
            });
            const id = createHtmlElement("div", {
                className: "sw-id",
                text: addon.id
            });
            const status = createHtmlElement("div", {
                className: "sw-status",
                text: getStatus(addon)
            });

            details.append(name, id);
            rowElement.append(checkbox, details, status);

            const row = {
                id: addon.id,
                name: addon.name,
                searchText: `${addon.name}\n${addon.id}`.toLocaleLowerCase(),
                currentActive: addon.isActive,
                currentUserDisabled: addon.userDisabled,
                appDisabled: addon.appDisabled,
                locked: !canToggle(addon),
                checkbox,
                status,
                element: rowElement
            };

            checkbox.addEventListener("change", () => {
                rowElement.classList.toggle(
                    "changed",
                    checkbox.checked !== row.currentActive
                );
                keepMessage = false;
                updateCounts();
            });

            rows.push(row);
            listElement.append(rowElement);
        }

        const compareNames = (a, b) => a.name.localeCompare(
            b.name,
            undefined,
            { sensitivity: "base" }
        );

        const compareRows = (a, b) => {
            if (a.appDisabled !== b.appDisabled) {
                return a.appDisabled ? 1 : -1;
            }

            switch (sortElement.value) {
                case "active-first":
                    if (a.currentActive !== b.currentActive) {
                        return a.currentActive ? -1 : 1;
                    }
                    break;

                case "user-disabled-first":
                    if (a.currentUserDisabled !== b.currentUserDisabled) {
                        return a.currentUserDisabled ? -1 : 1;
                    }
                    break;
            }

            return compareNames(a, b);
        };

        const renderRows = () => {
            const query = searchElement.value.trim().toLocaleLowerCase();

            for (const row of [...rows].sort(compareRows)) {
                const hiddenBySearch = Boolean(query) &&
                    !row.searchText.includes(query);
                const hiddenByFirefoxState = row.appDisabled &&
                    !showFirefoxDisabledElement.checked;

                row.element.hidden = hiddenBySearch || hiddenByFirefoxState;
                listElement.append(row.element);
            }

            updateCounts();
        };

        const refresh = async () => {
            for (const row of rows) {
                const addon = await AddonManager.getAddonByID(row.id);
                if (addon) updateRow(row, addon);
            }
            renderRows();
        };

        searchElement.addEventListener("input", renderRows);
        sortElement.addEventListener("change", renderRows);
        showFirefoxDisabledElement.addEventListener("change", renderRows);

        resetElement.addEventListener("click", async () => {
            keepMessage = true;
            messageElement.textContent = "Refreshing current states…";
            setBusy(true);

            try {
                await refresh();
                messageElement.textContent =
                    "Selections reset to the current live state.";
            } catch (error) {
                reportError(error);
                messageElement.textContent = "Refresh failed. See Browser Console.";
            } finally {
                setBusy(false);
            }
        });

        applyElement.addEventListener("click", async () => {
            const changes = rows.filter(
                row => row.checkbox.checked !== row.currentActive
            );
            if (!changes.length) return;

            keepMessage = true;
            messageElement.textContent = `Applying ${changes.length} change(s)…`;
            setBusy(true);

            let applied = 0;
            const failures = [];

            for (const row of changes) {
                try {
                    const addon = await AddonManager.getAddonByID(row.id);
                    if (!addon) {
                        throw new Error("Extension is no longer installed.");
                    }

                    if (row.checkbox.checked !== addon.isActive) {
                        if (row.checkbox.checked) {
                            if (
                                addon.appDisabled ||
                                !(addon.permissions & AddonManager.PERM_CAN_ENABLE)
                            ) {
                                throw new Error(
                                    "Firefox does not permit enabling it."
                                );
                            }
                            await addon.enable();
                        } else {
                            if (
                                !(addon.permissions & AddonManager.PERM_CAN_DISABLE)
                            ) {
                                throw new Error(
                                    "Firefox does not permit disabling it."
                                );
                            }
                            await addon.disable();
                        }
                    }

                    const updated = await AddonManager.getAddonByID(row.id);
                    if (!updated) {
                        throw new Error("Extension disappeared afterward.");
                    }

                    updateRow(row, updated);
                    applied++;
                } catch (error) {
                    failures.push({
                        name: row.name,
                        id: row.id,
                        error: error.message
                    });

                    const current = await AddonManager.getAddonByID(row.id);
                    if (current) updateRow(row, current);
                }
            }

            setBusy(false);
            messageElement.textContent = failures.length
                ? `${applied} applied; ${failures.length} failed. ` +
                    "See Browser Console."
                : `${applied} change(s) applied successfully.`;

            if (failures.length) console.table(failures);
            renderRows();
        });

        const handleClose = () => {
            if (!busy) close();
        };

        closeElement.addEventListener("click", handleClose);
        overlay.addEventListener("click", event => {
            if (event.target === overlay) handleClose();
        });
        overlay.addEventListener("keydown", event => {
            if (event.key === "Escape") handleClose();
        });

        renderRows();
        searchElement.focus();
    };

    const destroy = () => {
        close();
        document.getElementById(STYLE_ID)?.remove();
        delete window.ExtensionSwitchboard;
    };

    ensureStyle();
    ensureWidget();

    window.ExtensionSwitchboard = {
        version: VERSION,
        open,
        close,
        destroy
    };

    console.log(`Extension Switchboard ${VERSION} loaded.`);
})();// ExtensionSwitchboard.uc.js
