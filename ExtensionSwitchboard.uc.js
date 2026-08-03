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
 * - Summarizes each extension's current site-access scope.
 * - Reports batch-operation results, retains failed changes, and supports undo.
 * - Can reload the current tab after applying extension changes.
 */

(() => {
    "use strict";

    const VERSION = "0.4.0";
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
                align-items: flex-start;
                justify-content: space-between;
            }
            #${PANEL_ID} .sw-feedback {
                min-width: 0;
                flex: 1 1 auto;
            }
            #${PANEL_ID} .sw-results[hidden] { display: none; }
            #${PANEL_ID} .sw-results {
                max-height: 170px;
                overflow: auto;
                margin-top: 6px;
                font-size: 11px;
            }
            #${PANEL_ID} .sw-results summary {
                cursor: pointer;
                font-weight: 600;
            }
            #${PANEL_ID} .sw-result-group { margin-top: 6px; }
            #${PANEL_ID} .sw-result-title { font-weight: 600; }
            #${PANEL_ID} .sw-result-list {
                margin: 2px 0 0 18px;
                padding: 0;
            }
            #${PANEL_ID} .sw-result-list li { margin-block: 2px; }
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
                grid-template-columns: 28px minmax(0, 1fr) 165px;
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
            #${PANEL_ID} .sw-row.apply-failed .sw-scope {
                font-weight: 600;
                opacity: .9;
            }
            #${PANEL_ID} .sw-name {
                overflow: hidden;
                font-weight: 600;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${PANEL_ID} .sw-scope {
                overflow: hidden;
                margin-top: 2px;
                font-size: 11px;
                opacity: .68;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${PANEL_ID} .sw-category-select {
                width: 100%;
                min-width: 0;
                min-height: 30px;
            }
            #${PANEL_ID} .sw-actions {
                display: flex;
                flex: 0 0 auto;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
            }
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

    // One level of undo is retained for the lifetime of this browser window.
    let lastApplySnapshot = null;

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
        const feedbackElement = createHtmlElement("div", {
            className: "sw-feedback"
        });
        const messageElement = createHtmlElement("div", {
            className: "sw-message sw-small",
            text: "No unapplied changes."
        });
        const resultsElement = createHtmlElement("details", {
            className: "sw-results"
        });
        resultsElement.hidden = true;
        const resultsSummaryElement = createHtmlElement("summary", {
            text: "Operation details"
        });
        const resultsBodyElement = createHtmlElement("div", {
            className: "sw-results-body"
        });
        resultsElement.append(resultsSummaryElement, resultsBodyElement);
        feedbackElement.append(messageElement, resultsElement);

        const actions = createHtmlElement("div", { className: "sw-actions" });
        const resetElement = createHtmlElement("button", {
            className: "sw-reset",
            text: "Reset",
            attributes: { type: "button" }
        });
        const undoElement = createHtmlElement("button", {
            className: "sw-undo",
            text: "Undo last apply",
            attributes: {
                type: "button",
                title: "Restore the extension states from immediately before the last successful Apply operation"
            }
        });
        undoElement.disabled = true;
        const applyReloadElement = createHtmlElement("button", {
            className: "sw-apply-reload",
            text: "Apply and reload tab",
            attributes: { type: "button" }
        });
        applyReloadElement.disabled = true;
        const applyElement = createHtmlElement("button", {
            className: "sw-apply",
            text: "Apply changes",
            attributes: { type: "button" }
        });
        applyElement.disabled = true;

        actions.append(
            resetElement,
            undoElement,
            applyReloadElement,
            applyElement
        );
        footer.append(feedbackElement, actions);
        panel.append(header, toolbar, main, footer);
        overlay.append(panel);
        document.documentElement.append(overlay);

        let busy = false;
        let keepMessage = false;
        const rows = [];
        const categoryControls = [];

        const clearOperationResults = () => {
            resultsElement.hidden = true;
            resultsElement.open = false;
            resultsBodyElement.replaceChildren();
        };

        const appendResultGroup = (title, entries, formatter = value => value) => {
            if (!entries.length) return;

            const group = createHtmlElement("div", {
                className: "sw-result-group"
            });
            const heading = createHtmlElement("div", {
                className: "sw-result-title",
                text: `${title} (${entries.length})`
            });
            const list = createHtmlElement("ul", {
                className: "sw-result-list"
            });

            for (const entry of entries) {
                list.append(createHtmlElement("li", {
                    text: formatter(entry)
                }));
            }

            group.append(heading, list);
            resultsBodyElement.append(group);
        };

        const showOperationResults = ({ enabled, disabled, failures }) => {
            resultsBodyElement.replaceChildren();
            appendResultGroup("Enabled", enabled);
            appendResultGroup("Disabled", disabled);
            appendResultGroup(
                "Failed",
                failures,
                failure => `${failure.name}: ${failure.error}`
            );

            const total = enabled.length + disabled.length + failures.length;
            resultsElement.hidden = total === 0;
            resultsElement.open = failures.length > 0;
            resultsSummaryElement.textContent = failures.length
                ? `Operation details · ${failures.length} failed`
                : "Operation details";
        };

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

        const getSiteAccess = addon => {
            const permissionSource = addon.userPermissions ??
                addon.installPermissions ?? null;
            const hasPermissionMetadata =
                Array.isArray(permissionSource?.origins) ||
                Array.isArray(permissionSource?.permissions);

            if (!hasPermissionMetadata) {
                return {
                    key: "unknown",
                    label: "Site access unavailable",
                    title: "Firefox does not expose site-access information for this extension."
                };
            }

            const origins = Array.isArray(permissionSource.origins)
                ? permissionSource.origins
                : [];
            const permissions = Array.isArray(permissionSource.permissions)
                ? permissionSource.permissions
                : [];
            const originSet = new Set(origins);
            const allSites =
                originSet.has("<all_urls>") ||
                originSet.has("*://*/*") ||
                (originSet.has("http://*/*") &&
                    originSet.has("https://*/*"));

            if (allSites) {
                return {
                    key: "all-sites",
                    label: "All sites",
                    title: "This extension has persistent access to all ordinary websites."
                };
            }

            if (origins.length > 0) {
                return {
                    key: "limited-sites",
                    label: "Limited sites",
                    title: "This extension has persistent access only to selected sites or URL patterns."
                };
            }

            if (permissions.includes("activeTab")) {
                return {
                    key: "on-demand",
                    label: "On demand",
                    title: "This extension receives temporary access to the current site after a user action."
                };
            }

            return {
                key: "no-site-access",
                label: "No site access",
                title: "This extension does not have persistent or active-tab access to website content."
            };
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
            const changeLabel = changed === 1 ? "change" : "changes";
            const undoCount = lastApplySnapshot?.entries?.length ?? 0;

            summaryElement.textContent =
                `${rows.length} extensions · ${active} active · ` +
                `${config.categories.length + 1} categories · ` +
                `${firefoxDisabled} Firefox-disabled`;
            shownElement.textContent = `${visible} shown`;

            applyElement.disabled = busy || changed === 0;
            applyReloadElement.disabled = busy || changed === 0;
            applyElement.textContent = changed
                ? `Apply ${changed} ${changeLabel}`
                : "Apply changes";
            applyReloadElement.textContent = changed
                ? `Apply ${changed} ${changeLabel} and reload tab`
                : "Apply and reload tab";

            undoElement.disabled = busy || undoCount === 0;
            undoElement.textContent = undoCount
                ? `Undo last apply (${undoCount})`
                : "Undo last apply";

            if (!busy && changed === 0 && !keepMessage) {
                messageElement.textContent = "No unapplied changes.";
            }
        };

        const updateRowStateClasses = row => {
            row.element.classList.toggle("active", row.currentActive);
            row.element.classList.toggle(
                "user-disabled",
                row.currentUserDisabled
            );
            row.element.classList.toggle(
                "firefox-disabled",
                row.appDisabled
            );
        };

        const updateCheckboxDescription = row => {
            let title;

            if (row.appDisabled) {
                title =
                    "Firefox has disabled this extension, so it cannot be enabled from the switchboard.";
            } else if (row.locked) {
                title =
                    "Firefox does not permit changing this extension from the switchboard.";
            } else if (row.checkbox.checked !== row.currentActive) {
                title = row.checkbox.checked
                    ? "Will be enabled when Apply changes is clicked."
                    : "Will be disabled when Apply changes is clicked.";
            } else {
                title = row.currentActive
                    ? "Enabled. Clear this checkbox and apply changes to disable it."
                    : "Disabled. Select this checkbox and apply changes to enable it.";
            }

            row.checkbox.title = title;
            row.checkbox.setAttribute("aria-label", `${row.name}: ${title}`);
        };

        const updateRowChangeState = row => {
            row.element.classList.toggle(
                "changed",
                row.checkbox.checked !== row.currentActive
            );
            updateCheckboxDescription(row);
        };

        const updateRowScope = row => {
            const parts = [];

            if (row.appDisabled) parts.push("Disabled by Firefox");
            parts.push(`Site access: ${row.siteAccess.label}`);
            if (row.lastError) parts.push(`Operation failed: ${row.lastError}`);

            row.scope.textContent = parts.join(" · ");
            row.scope.title = row.lastError
                ? `${row.siteAccess.title}

Last operation failed: ${row.lastError}`
                : row.siteAccess.title;
            row.element.classList.toggle("apply-failed", Boolean(row.lastError));
        };

        const updateRow = (
            row,
            addon,
            { preserveDesired = false, clearFailure = true } = {}
        ) => {
            row.currentActive = addon.isActive;
            row.currentUserDisabled = addon.userDisabled;
            row.appDisabled = addon.appDisabled;
            row.locked = !canToggle(addon);
            row.siteAccess = getSiteAccess(addon);

            if (!preserveDesired) {
                row.checkbox.checked = addon.isActive;
            }
            if (clearFailure) {
                row.lastError = null;
            }

            row.checkbox.disabled = busy || row.locked;
            updateRowScope(row);
            updateRowStateClasses(row);
            updateRowChangeState(row);
        };

        const markRowFailure = (row, error) => {
            row.lastError = error instanceof Error ? error.message : String(error);
            updateRowScope(row);
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
            row.searchText = `${row.name}\n${row.id}\n${categoryById(selectedId).name}\n${row.siteAccess.label}`
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
            undoElement.disabled = value;
            applyReloadElement.disabled = value;
            applyElement.disabled = value;
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
                text: addon.name,
                attributes: { title: `Extension ID: ${addon.id}` }
            });
            const siteAccess = getSiteAccess(addon);
            const scope = createHtmlElement("div", {
                className: "sw-scope",
                text: addon.appDisabled
                    ? `Disabled by Firefox · Site access: ${siteAccess.label}`
                    : `Site access: ${siteAccess.label}`,
                attributes: { title: siteAccess.title }
            });
            const categorySelect = createHtmlElement("select", {
                className: "sw-category-select",
                attributes: {
                    "aria-label": `Category for ${addon.name}`,
                    title: "Assign this extension to one category"
                }
            });

            details.append(name, scope);
            rowElement.append(checkbox, details, categorySelect);

            const row = {
                id: addon.id,
                name: addon.name,
                searchText: "",
                currentActive: addon.isActive,
                currentUserDisabled: addon.userDisabled,
                appDisabled: addon.appDisabled,
                locked: !canToggle(addon),
                siteAccess,
                lastError: null,
                checkbox,
                categorySelect,
                scope,
                element: rowElement
            };

            updateRowStateClasses(row);
            updateRowChangeState(row);
            rebuildCategorySelect(row);

            checkbox.addEventListener("change", () => {
                row.lastError = null;
                updateRowScope(row);
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

                row.searchText = `${row.name}\n${row.id}\n${categoryById(newCategoryId).name}\n${row.siteAccess.label}`
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
                            row.lastError = null;
                            updateRowScope(row);
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

            selectedCategoryId = UNCATEGORIZED_ID;
            for (const row of rows) rebuildCategorySelect(row);
            rebuildCategoryList();
            renderRows();
            keepMessage = true;
            messageElement.textContent =
                `Created category “${name}”. Showing Uncategorized extensions.`;
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
            clearOperationResults();
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

        const performApply = async ({ reloadCurrentTab = false } = {}) => {
            const changes = rows.filter(
                row => row.checkbox.checked !== row.currentActive
            );
            if (!changes.length) return;

            const browserToReload = reloadCurrentTab
                ? window.gBrowser?.selectedBrowser ?? null
                : null;

            keepMessage = true;
            clearOperationResults();
            messageElement.textContent = `Applying ${changes.length} change(s)…`;
            setBusy(true);

            const enabled = [];
            const disabled = [];
            const failures = [];
            const undoEntries = [];

            for (const row of changes) {
                const desiredActive = row.checkbox.checked;

                try {
                    const addon = await AddonManager.getAddonByID(row.id);
                    if (!addon) {
                        throw new Error("Extension is no longer installed.");
                    }

                    const previousActive = addon.isActive;

                    if (desiredActive !== previousActive) {
                        if (desiredActive) {
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
                    if (updated.isActive !== desiredActive) {
                        throw new Error(
                            `Firefox reported the extension as ${
                                updated.isActive ? "enabled" : "disabled"
                            } after the operation.`
                        );
                    }

                    if (previousActive !== updated.isActive) {
                        undoEntries.push({
                            id: row.id,
                            name: row.name,
                            active: previousActive
                        });
                        (updated.isActive ? enabled : disabled).push(row.name);
                    }

                    updateRow(row, updated);
                } catch (error) {
                    const failure = {
                        name: row.name,
                        id: row.id,
                        error: error instanceof Error
                            ? error.message
                            : String(error)
                    };
                    failures.push(failure);

                    try {
                        const current = await AddonManager.getAddonByID(row.id);
                        if (current) {
                            updateRow(row, current, {
                                preserveDesired: true,
                                clearFailure: false
                            });
                        }
                    } catch (refreshError) {
                        reportError(refreshError);
                    }

                    markRowFailure(row, failure.error);
                }
            }

            if (undoEntries.length) {
                lastApplySnapshot = {
                    createdAt: Date.now(),
                    entries: undoEntries
                };
            }

            setBusy(false);
            showOperationResults({ enabled, disabled, failures });

            const applied = enabled.length + disabled.length;
            if (failures.length) {
                messageElement.textContent =
                    `${applied} applied; ${failures.length} failed. ` +
                    "Failed changes remain pending.";
                console.table(failures);
            } else if (applied) {
                messageElement.textContent =
                    `${enabled.length} enabled; ${disabled.length} disabled.`;
            } else {
                messageElement.textContent =
                    "No extension state changes were necessary.";
            }

            renderRows();

            if (reloadCurrentTab && applied > 0) {
                try {
                    if (!browserToReload || typeof browserToReload.reload !== "function") {
                        throw new Error("No reloadable current tab was found.");
                    }
                    browserToReload.reload();
                    messageElement.textContent += " Current tab reloaded.";
                } catch (error) {
                    reportError(error);
                    messageElement.textContent +=
                        " The current tab could not be reloaded.";
                }
            }
        };

        applyElement.addEventListener("click", () => {
            performApply().catch(reportError);
        });

        applyReloadElement.addEventListener("click", () => {
            performApply({ reloadCurrentTab: true }).catch(reportError);
        });

        undoElement.addEventListener("click", async () => {
            const snapshot = lastApplySnapshot;
            if (!snapshot?.entries?.length) return;

            keepMessage = true;
            clearOperationResults();
            messageElement.textContent =
                `Restoring ${snapshot.entries.length} previous state(s)…`;
            setBusy(true);

            const enabled = [];
            const disabled = [];
            const failures = [];
            const remainingEntries = [];

            for (const entry of snapshot.entries) {
                const row = rows.find(candidate => candidate.id === entry.id);
                const hadPendingSelection = Boolean(
                    row && row.checkbox.checked !== row.currentActive
                );

                try {
                    const addon = await AddonManager.getAddonByID(entry.id);
                    if (!addon) {
                        throw new Error("Extension is no longer installed.");
                    }

                    const previousActive = addon.isActive;

                    if (previousActive !== entry.active) {
                        if (entry.active) {
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

                    const updated = await AddonManager.getAddonByID(entry.id);
                    if (!updated) {
                        throw new Error("Extension disappeared afterward.");
                    }
                    if (updated.isActive !== entry.active) {
                        throw new Error(
                            `Firefox reported the extension as ${
                                updated.isActive ? "enabled" : "disabled"
                            } after the undo operation.`
                        );
                    }

                    if (previousActive !== updated.isActive) {
                        (updated.isActive ? enabled : disabled).push(entry.name);
                    }
                    if (row) {
                        updateRow(row, updated, {
                            preserveDesired: hadPendingSelection
                        });
                    }
                } catch (error) {
                    const failure = {
                        name: entry.name,
                        id: entry.id,
                        error: error instanceof Error
                            ? error.message
                            : String(error)
                    };
                    failures.push(failure);
                    remainingEntries.push(entry);

                    if (row) {
                        try {
                            const current = await AddonManager.getAddonByID(entry.id);
                            if (current) {
                                updateRow(row, current, {
                                    preserveDesired: true,
                                    clearFailure: false
                                });
                            }
                        } catch (refreshError) {
                            reportError(refreshError);
                        }

                        if (!hadPendingSelection) {
                            row.checkbox.checked = entry.active;
                        }
                        markRowFailure(row, failure.error);
                    }
                }
            }

            lastApplySnapshot = remainingEntries.length
                ? { ...snapshot, entries: remainingEntries }
                : null;

            setBusy(false);
            showOperationResults({ enabled, disabled, failures });

            const restored = enabled.length + disabled.length;
            messageElement.textContent = failures.length
                ? `${restored} restored; ${failures.length} failed. ` +
                    "Failed undo changes remain available for retry."
                : restored
                    ? `${restored} extension state(s) restored.`
                    : "The previous extension states were already restored.";

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
        lastApplySnapshot = null;
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
