/*
 * Extension Switchboard
 * Persistent Firefox chrome script loaded through AutoConfig.
 *
 * Features:
 * - Enumerates installed user extensions dynamically.
 * - Enables/disables individual extensions in batches.
 * - Assigns each extension to exactly one user-defined category.
 * - Enables/disables an entire category while retaining individual control.
 * - Stores categories and assignments in the Firefox profile preferences.
 */

(() => {
    "use strict";

    const VERSION = "0.2.1";
    const WIDGET_ID = "extension-switchboard-button";
    const PANEL_ID = "extension-switchboard-panel";
    const STYLE_ID = "extension-switchboard-style";
    const HTML_NS = "http://www.w3.org/1999/xhtml";
    const CONFIG_PREF = "extensionSwitchboard.config";
    const UNCATEGORIZED_ID = "__uncategorized__";

    if (
        window.ExtensionSwitchboard?.version === VERSION ||
        document.documentElement.getAttribute("windowtype") !== "navigator:browser"
    ) {
        return;
    }

    const { classes: Cc, interfaces: Ci } = Components;

    const { AddonManager } = ChromeUtils.importESModule(
        "resource://gre/modules/AddonManager.sys.mjs"
    );

    const CustomizableUI = window.CustomizableUI ??
        ChromeUtils.importESModule(
            "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
        ).CustomizableUI;

    const preferences = Cc["@mozilla.org/preferences-service;1"]
        .getService(Ci.nsIPrefBranch);

    // Recent Firefox builds expose prompts through Services.prompt rather
    // than the former @mozilla.org/embedcomp/prompt-service;1 contract.
    // Keep this optional so the switchboard can still load if prompting
    // changes again; the category UI falls back to DOM window dialogs.
    const promptService = window.Services?.prompt ?? null;

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

    const createDefaultConfig = () => ({
        schemaVersion: 1,
        categories: [],
        assignments: {}
    });

    const normalizeCategoryName = name => name.trim().toLocaleLowerCase();

    const sanitizeConfig = value => {
        const sanitized = createDefaultConfig();
        const categoryIds = new Set();
        const categoryNames = new Set();

        if (!value || typeof value !== "object") {
            return sanitized;
        }

        for (const candidate of Array.isArray(value.categories)
            ? value.categories
            : []) {
            const id = typeof candidate?.id === "string"
                ? candidate.id.trim()
                : "";
            const name = typeof candidate?.name === "string"
                ? candidate.name.trim()
                : "";
            const normalizedName = normalizeCategoryName(name);

            if (
                !id ||
                !name ||
                id === UNCATEGORIZED_ID ||
                categoryIds.has(id) ||
                categoryNames.has(normalizedName)
            ) {
                continue;
            }

            categoryIds.add(id);
            categoryNames.add(normalizedName);
            sanitized.categories.push({ id, name });
        }

        if (value.assignments && typeof value.assignments === "object") {
            for (const [extensionId, categoryId] of Object.entries(
                value.assignments
            )) {
                if (
                    typeof extensionId === "string" &&
                    typeof categoryId === "string" &&
                    categoryIds.has(categoryId)
                ) {
                    sanitized.assignments[extensionId] = categoryId;
                }
            }
        }

        return sanitized;
    };

    const loadConfig = () => {
        try {
            const raw = preferences.getStringPref(CONFIG_PREF, "");
            if (!raw) return createDefaultConfig();
            return sanitizeConfig(JSON.parse(raw));
        } catch (error) {
            reportError(error);
            return createDefaultConfig();
        }
    };

    const saveConfig = config => {
        preferences.setStringPref(CONFIG_PREF, JSON.stringify(config));
    };

    const makeCategoryId = () => {
        if (typeof window.crypto?.randomUUID === "function") {
            return `category-${window.crypto.randomUUID()}`;
        }

        return `category-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`;
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
                width: min(980px, calc(100vw - 40px));
                height: min(820px, calc(100vh - 40px));
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
            #${PANEL_ID} h1,
            #${PANEL_ID} h2 { margin: 0; }
            #${PANEL_ID} h1 { font-size: 18px; }
            #${PANEL_ID} h2 { font-size: 14px; }
            #${PANEL_ID} .sw-small {
                margin-top: 4px;
                font-size: 12px;
                opacity: .75;
            }
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
            #${PANEL_ID} .sw-main {
                min-height: 0;
                display: grid;
                grid-template-columns: 250px minmax(0, 1fr);
            }
            #${PANEL_ID} .sw-categories {
                min-width: 0;
                display: grid;
                grid-template-rows: auto 1fr;
                border-right: 1px solid GrayText;
                background: color-mix(in srgb, Canvas 94%, CanvasText 6%);
            }
            #${PANEL_ID} .sw-category-header {
                display: grid;
                gap: 8px;
                padding: 12px;
                border-bottom: 1px solid GrayText;
            }
            #${PANEL_ID} .sw-category-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            #${PANEL_ID} .sw-category-actions button {
                min-height: 28px;
                padding: 3px 8px;
                font-size: 11px;
            }
            #${PANEL_ID} .sw-category-list {
                overflow: auto;
                padding-block: 5px;
            }
            #${PANEL_ID} .sw-category-row {
                display: grid;
                grid-template-columns: 24px minmax(0, 1fr) auto;
                gap: 6px;
                align-items: center;
                min-height: 38px;
                padding: 4px 10px;
            }
            #${PANEL_ID} .sw-category-row:hover,
            #${PANEL_ID} .sw-category-row.selected {
                background: color-mix(in srgb, AccentColor 13%, transparent);
            }
            #${PANEL_ID} .sw-category-row.selected {
                box-shadow: inset 3px 0 AccentColor;
            }
            #${PANEL_ID} .sw-category-name {
                min-width: 0;
                min-height: 28px;
                overflow: hidden;
                padding: 2px 4px;
                border: 0;
                background: transparent;
                color: inherit;
                font: inherit;
                font-weight: 600;
                text-align: left;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${PANEL_ID} .sw-category-count {
                font-size: 10px;
                opacity: .68;
                white-space: nowrap;
            }
            #${PANEL_ID} .sw-all-row {
                grid-template-columns: 24px minmax(0, 1fr) auto;
            }
            #${PANEL_ID} .sw-all-row .sw-all-spacer {
                width: 16px;
            }
            #${PANEL_ID} .sw-extension-area {
                min-width: 0;
                min-height: 0;
                display: grid;
                grid-template-rows: 1fr;
            }
            #${PANEL_ID} .sw-list { overflow: auto; padding-block: 5px; }
            #${PANEL_ID} .sw-row {
                display: grid;
                grid-template-columns: 28px minmax(0, 1fr) 165px auto;
                gap: 8px;
                align-items: center;
                min-height: 54px;
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
            #${PANEL_ID} .sw-category-select {
                width: 100%;
                min-width: 0;
                min-height: 30px;
            }
            #${PANEL_ID} .sw-status { font-size: 11px; white-space: nowrap; }
            #${PANEL_ID} .sw-actions { display: flex; gap: 8px; }
            #${PANEL_ID} button {
                min-height: 32px;
                padding: 5px 12px;
                cursor: pointer;
            }
            #${PANEL_ID} button:disabled,
            #${PANEL_ID} input:disabled,
            #${PANEL_ID} select:disabled {
                cursor: not-allowed;
                opacity: .55;
            }
            #${PANEL_ID} .sw-close {
                min-width: 32px;
                padding-inline: 8px;
                font-size: 18px;
            }
            @media (max-width: 760px) {
                #${PANEL_ID} .sw-panel {
                    width: calc(100vw - 20px);
                    height: calc(100vh - 20px);
                }
                #${PANEL_ID} .sw-main {
                    grid-template-columns: 200px minmax(0, 1fr);
                }
                #${PANEL_ID} .sw-row {
                    grid-template-columns: 28px minmax(0, 1fr) 130px;
                }
                #${PANEL_ID} .sw-status { display: none; }
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

    const askForCategoryName = (title, prompt, initialValue = "") => {
        if (promptService?.prompt) {
            const input = { value: initialValue };
            const accepted = promptService.prompt(
                window,
                title,
                prompt,
                input,
                null,
                {}
            );

            return accepted ? input.value.trim() : null;
        }

        const value = window.prompt(prompt, initialValue);
        return value === null ? null : value.trim();
    };

    const showAlert = message => {
        if (promptService?.alert) {
            promptService.alert(window, "Extension Switchboard", message);
            return;
        }

        window.alert(message);
    };

    const confirmAction = (title, message) => {
        if (promptService?.confirm) {
            return promptService.confirm(window, title, message);
        }

        return window.confirm(message);
    };

    const open = async () => {
        ensureStyle();
        close();

        const config = loadConfig();
        let selectedCategoryId = null;

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
                placeholder: "Filter by extension name, ID, or category…",
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

        const main = createHtmlElement("div", { className: "sw-main" });

        const categoriesArea = createHtmlElement("aside", {
            className: "sw-categories"
        });
        const categoryHeader = createHtmlElement("div", {
            className: "sw-category-header"
        });
        const categoryTitle = createHtmlElement("h2", { text: "Categories" });
        const categoryHelp = createHtmlElement("div", {
            className: "sw-small",
            text: "Toggle a category, or click its name to filter."
        });
        const categoryActions = createHtmlElement("div", {
            className: "sw-category-actions"
        });
        const addCategoryElement = createHtmlElement("button", {
            text: "New",
            attributes: { type: "button", title: "Create category" }
        });
        const renameCategoryElement = createHtmlElement("button", {
            text: "Rename",
            attributes: { type: "button", title: "Rename selected category" }
        });
        const deleteCategoryElement = createHtmlElement("button", {
            text: "Delete",
            attributes: { type: "button", title: "Delete selected category" }
        });
        categoryActions.append(
            addCategoryElement,
            renameCategoryElement,
            deleteCategoryElement
        );
        categoryHeader.append(categoryTitle, categoryHelp, categoryActions);

        const categoryListElement = createHtmlElement("div", {
            className: "sw-category-list"
        });
        categoriesArea.append(categoryHeader, categoryListElement);

        const extensionArea = createHtmlElement("section", {
            className: "sw-extension-area"
        });
        const listElement = createHtmlElement("div", { className: "sw-list" });
        extensionArea.append(listElement);

        main.append(categoriesArea, extensionArea);

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
        panel.append(header, toolbar, main, footer);
        overlay.append(panel);
        document.documentElement.append(overlay);

        let busy = false;
        let keepMessage = false;
        const rows = [];
        const categoryControls = [];

        const categoryById = categoryId => {
            if (categoryId === UNCATEGORIZED_ID) {
                return {
                    id: UNCATEGORIZED_ID,
                    name: "Uncategorized",
                    builtIn: true
                };
            }

            const category = config.categories.find(
                item => item.id === categoryId
            );

            return category ? { ...category, builtIn: false } : {
                id: UNCATEGORIZED_ID,
                name: "Uncategorized",
                builtIn: true
            };
        };

        const categoriesForDisplay = () => [
            {
                id: UNCATEGORIZED_ID,
                name: "Uncategorized",
                builtIn: true
            },
            ...config.categories.map(category => ({
                ...category,
                builtIn: false
            }))
        ];

        const assignedCategoryId = extensionId => {
            const configuredId = config.assignments[extensionId];
            return config.categories.some(category => category.id === configuredId)
                ? configuredId
                : UNCATEGORIZED_ID;
        };

        const persistConfig = () => {
            try {
                saveConfig(config);
                return true;
            } catch (error) {
                reportError(error);
                messageElement.textContent =
                    "Category configuration could not be saved. See Browser Console.";
                keepMessage = true;
                return false;
            }
        };

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

        const updateCategorySelectionControls = () => {
            const selected = categoryById(selectedCategoryId);
            const editable = selectedCategoryId !== null && !selected.builtIn;

            renameCategoryElement.disabled = busy || !editable;
            deleteCategoryElement.disabled = busy || !editable;
            addCategoryElement.disabled = busy;
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
                `${config.categories.length + 1} categories · ` +
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

        const updateRowChangeState = row => {
            row.element.classList.toggle(
                "changed",
                row.checkbox.checked !== row.currentActive
            );
        };

        const updateRow = (row, addon) => {
            row.currentActive = addon.isActive;
            row.currentUserDisabled = addon.userDisabled;
            row.appDisabled = addon.appDisabled;
            row.locked = !canToggle(addon);
            row.checkbox.checked = addon.isActive;
            row.checkbox.disabled = busy || row.locked;
            row.status.textContent = getStatus(addon);
            updateRowChangeState(row);
        };

        const rebuildCategorySelect = row => {
            const selectedId = assignedCategoryId(row.id);
            row.categorySelect.replaceChildren();

            for (const category of categoriesForDisplay()) {
                const option = createHtmlElement("option", {
                    text: category.name,
                    attributes: { value: category.id }
                });
                row.categorySelect.append(option);
            }

            row.categorySelect.value = selectedId;
            row.categorySelect.disabled = busy;
            row.searchText = `${row.name}\n${row.id}\n${categoryById(selectedId).name}`
                .toLocaleLowerCase();
        };

        const updateCategoryStates = () => {
            for (const control of categoryControls) {
                const members = rows.filter(
                    row => assignedCategoryId(row.id) === control.categoryId
                );
                const toggleableMembers = members.filter(row => !row.locked);
                const enabled = toggleableMembers.filter(
                    row => row.checkbox.checked
                ).length;

                control.checkbox.indeterminate =
                    enabled > 0 && enabled < toggleableMembers.length;
                control.checkbox.checked =
                    toggleableMembers.length > 0 &&
                    enabled === toggleableMembers.length;
                control.checkbox.disabled = busy || toggleableMembers.length === 0;

                const locked = members.length - toggleableMembers.length;
                control.count.textContent = locked
                    ? `${enabled}/${toggleableMembers.length} · ${locked} locked`
                    : `${enabled}/${toggleableMembers.length}`;

                control.element.classList.toggle(
                    "selected",
                    selectedCategoryId === control.categoryId
                );
            }

            updateCategorySelectionControls();
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
                row.categorySelect.disabled = value;
            }

            for (const control of categoryControls) {
                control.checkbox.disabled = value || control.checkbox.disabled;
                control.nameButton.disabled = value;
            }

            updateCategoryStates();
            updateCounts();
        };

        const addons = (await AddonManager.getAddonsByTypes(["extension"]))
            .filter(addon => !addon.hidden && !addon.isSystem);

        for (const addon of addons) {
            const rowElement = createHtmlElement("div", { className: "sw-row" });
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
            const categorySelect = createHtmlElement("select", {
                className: "sw-category-select",
                attributes: {
                    "aria-label": `Category for ${addon.name}`,
                    title: "Assign this extension to one category"
                }
            });
            const status = createHtmlElement("div", {
                className: "sw-status",
                text: getStatus(addon)
            });

            details.append(name, id);
            rowElement.append(checkbox, details, categorySelect, status);

            const row = {
                id: addon.id,
                name: addon.name,
                searchText: "",
                currentActive: addon.isActive,
                currentUserDisabled: addon.userDisabled,
                appDisabled: addon.appDisabled,
                locked: !canToggle(addon),
                checkbox,
                categorySelect,
                status,
                element: rowElement
            };

            rebuildCategorySelect(row);

            checkbox.addEventListener("change", () => {
                updateRowChangeState(row);
                keepMessage = false;
                updateCategoryStates();
                updateCounts();
            });

            categorySelect.addEventListener("change", () => {
                const previousCategoryId = assignedCategoryId(row.id);
                const newCategoryId = categorySelect.value;

                if (newCategoryId === UNCATEGORIZED_ID) {
                    delete config.assignments[row.id];
                } else {
                    config.assignments[row.id] = newCategoryId;
                }

                if (!persistConfig()) {
                    if (previousCategoryId === UNCATEGORIZED_ID) {
                        delete config.assignments[row.id];
                    } else {
                        config.assignments[row.id] = previousCategoryId;
                    }
                    rebuildCategorySelect(row);
                    rebuildCategoryList();
                    renderRows();
                    return;
                }

                row.searchText = `${row.name}\n${row.id}\n${categoryById(newCategoryId).name}`
                    .toLocaleLowerCase();
                keepMessage = true;
                messageElement.textContent =
                    `Assigned “${row.name}” to ${categoryById(newCategoryId).name}.`;
                rebuildCategoryList();
                renderRows();
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
                const hiddenByCategory = selectedCategoryId !== null &&
                    assignedCategoryId(row.id) !== selectedCategoryId;

                row.element.hidden =
                    hiddenBySearch || hiddenByFirefoxState || hiddenByCategory;
                listElement.append(row.element);
            }

            updateCategoryStates();
            updateCounts();
        };

        function rebuildCategoryList() {
            categoryListElement.replaceChildren();
            categoryControls.length = 0;

            const allRow = createHtmlElement("div", {
                className: "sw-category-row sw-all-row"
            });
            const allSpacer = createHtmlElement("span", {
                className: "sw-all-spacer"
            });
            const allName = createHtmlElement("button", {
                className: "sw-category-name",
                text: "All extensions",
                attributes: { type: "button" }
            });
            const allCount = createHtmlElement("span", {
                className: "sw-category-count",
                text: String(rows.length)
            });
            allRow.classList.toggle("selected", selectedCategoryId === null);
            allName.disabled = busy;
            allName.addEventListener("click", () => {
                selectedCategoryId = null;
                rebuildCategoryList();
                renderRows();
            });
            allRow.append(allSpacer, allName, allCount);
            categoryListElement.append(allRow);

            for (const category of categoriesForDisplay()) {
                const categoryRow = createHtmlElement("div", {
                    className: "sw-category-row"
                });
                const checkbox = createHtmlElement("input", {
                    attributes: {
                        type: "checkbox",
                        title: `Enable or disable all toggleable extensions in ${category.name}`,
                        "aria-label": `Toggle category ${category.name}`
                    }
                });
                const nameButton = createHtmlElement("button", {
                    className: "sw-category-name",
                    text: category.name,
                    attributes: {
                        type: "button",
                        title: `Show only extensions in ${category.name}`
                    }
                });
                const count = createHtmlElement("span", {
                    className: "sw-category-count"
                });

                checkbox.addEventListener("change", () => {
                    const desiredState = checkbox.checked;

                    for (const row of rows) {
                        if (
                            assignedCategoryId(row.id) === category.id &&
                            !row.locked
                        ) {
                            row.checkbox.checked = desiredState;
                            updateRowChangeState(row);
                        }
                    }

                    keepMessage = false;
                    updateCategoryStates();
                    updateCounts();
                });

                nameButton.addEventListener("click", () => {
                    selectedCategoryId = category.id;
                    rebuildCategoryList();
                    renderRows();
                });

                categoryRow.append(checkbox, nameButton, count);
                categoryListElement.append(categoryRow);
                categoryControls.push({
                    categoryId: category.id,
                    checkbox,
                    nameButton,
                    count,
                    element: categoryRow
                });
            }

            updateCategoryStates();
        }

        const refresh = async () => {
            for (const row of rows) {
                const addon = await AddonManager.getAddonByID(row.id);
                if (addon) updateRow(row, addon);
            }
            renderRows();
        };

        addCategoryElement.addEventListener("click", () => {
            const name = askForCategoryName(
                "Create category",
                "Enter a name for the new category:"
            );
            if (name === null) return;

            if (!name) {
                showAlert("A category name cannot be empty.");
                return;
            }

            if (
                name.length > 80 ||
                normalizeCategoryName(name) ===
                    normalizeCategoryName("Uncategorized") ||
                config.categories.some(
                    category => normalizeCategoryName(category.name) ===
                        normalizeCategoryName(name)
                )
            ) {
                showAlert(
                    name.length > 80
                        ? "Category names are limited to 80 characters."
                        : "That category name is already in use."
                );
                return;
            }

            const category = { id: makeCategoryId(), name };
            config.categories.push(category);

            if (!persistConfig()) {
                config.categories.pop();
                return;
            }

            selectedCategoryId = category.id;
            for (const row of rows) rebuildCategorySelect(row);
            rebuildCategoryList();
            renderRows();
            keepMessage = true;
            messageElement.textContent = `Created category “${name}”.`;
        });

        renameCategoryElement.addEventListener("click", () => {
            const category = config.categories.find(
                item => item.id === selectedCategoryId
            );
            if (!category) return;

            const name = askForCategoryName(
                "Rename category",
                "Enter a new category name:",
                category.name
            );
            if (name === null || name === category.name) return;

            if (!name) {
                showAlert("A category name cannot be empty.");
                return;
            }

            if (
                name.length > 80 ||
                normalizeCategoryName(name) ===
                    normalizeCategoryName("Uncategorized") ||
                config.categories.some(
                    item => item.id !== category.id &&
                        normalizeCategoryName(item.name) ===
                            normalizeCategoryName(name)
                )
            ) {
                showAlert(
                    name.length > 80
                        ? "Category names are limited to 80 characters."
                        : "That category name is already in use."
                );
                return;
            }

            const previousName = category.name;
            category.name = name;

            if (!persistConfig()) {
                category.name = previousName;
                return;
            }

            for (const row of rows) rebuildCategorySelect(row);
            rebuildCategoryList();
            renderRows();
            keepMessage = true;
            messageElement.textContent = `Renamed category to “${name}”.`;
        });

        deleteCategoryElement.addEventListener("click", () => {
            const categoryIndex = config.categories.findIndex(
                item => item.id === selectedCategoryId
            );
            if (categoryIndex < 0) return;

            const category = config.categories[categoryIndex];
            const assignedRows = rows.filter(
                row => assignedCategoryId(row.id) === category.id
            );
            const confirmed = confirmAction(
                "Delete category",
                `Delete “${category.name}”?\n\n` +
                `${assignedRows.length} extension(s) will be moved to Uncategorized.`
            );
            if (!confirmed) return;

            const previousConfig = JSON.parse(JSON.stringify(config));
            config.categories.splice(categoryIndex, 1);

            for (const [extensionId, categoryId] of Object.entries(
                config.assignments
            )) {
                if (categoryId === category.id) {
                    delete config.assignments[extensionId];
                }
            }

            if (!persistConfig()) {
                config.categories = previousConfig.categories;
                config.assignments = previousConfig.assignments;
                return;
            }

            selectedCategoryId = UNCATEGORIZED_ID;
            for (const row of rows) rebuildCategorySelect(row);
            rebuildCategoryList();
            renderRows();
            keepMessage = true;
            messageElement.textContent =
                `Deleted “${category.name}”; its extensions are now Uncategorized.`;
        });

        searchElement.addEventListener("input", renderRows);
        sortElement.addEventListener("change", renderRows);
        showFirefoxDisabledElement.addEventListener("change", renderRows);

        resetElement.addEventListener("click", async () => {
            keepMessage = true;
            messageElement.textContent = "Refreshing current extension states…";
            setBusy(true);

            try {
                await refresh();
                messageElement.textContent =
                    "Extension selections reset to the current live state.";
            } catch (error) {
                reportError(error);
                messageElement.textContent =
                    "Refresh failed. See Browser Console.";
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

        rebuildCategoryList();
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
})();