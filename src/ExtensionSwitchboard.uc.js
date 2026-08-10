/*
 * Extension Switchboard
 * Persistent Firefox chrome script loaded through AutoConfig.
 *
 * Architecture:
 * - FirefoxCompat: Firefox-specific APIs and compatibility fallbacks.
 * - ConfigStore: preference persistence and import/export validation.
 * - CategoryManager: category rules and extension assignments.
 * - ExtensionService: installed-extension discovery and state changes.
 * - SwitchboardPanel: DOM construction, rendering, and user interaction.
 */

(() => {
    "use strict";

    const APP = Object.freeze({
        VERSION: "0.7.0",
        WIDGET_ID: "extension-switchboard-button",
        PANEL_ID: "extension-switchboard-panel",
        STYLE_ID: "extension-switchboard-style",
        HTML_NS: "http://www.w3.org/1999/xhtml",
        CONFIG_PREF: "extensionSwitchboard.config",
        CONFIG_SCHEMA_VERSION: 1,
        UNCATEGORIZED_ID: "__uncategorized__",
        EXPORT_FORMAT: "extension-switchboard-config",
        EXPORT_VERSION: 1
    });

    const FALLBACK_EXTENSION_ICON =
        "chrome://mozapps/skin/extensions/extensionGeneric.svg";

    if (document.documentElement.getAttribute("windowtype") !== "navigator:browser") {
        return;
    }

    if (window.ExtensionSwitchboard?.version === APP.VERSION) {
        return;
    }

    try {
        window.ExtensionSwitchboard?.destroy?.();
    } catch {
        // A previous version may not support clean hot replacement.
    }

    const FirefoxCompat = (() => {
        const { classes: Cc, interfaces: Ci } = Components;

        const AddonManager = ChromeUtils.importESModule(
            "resource://gre/modules/AddonManager.sys.mjs"
        ).AddonManager;

        const CustomizableUI = window.CustomizableUI ??
            ChromeUtils.importESModule(
                "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
            ).CustomizableUI;

        const preferences = Cc["@mozilla.org/preferences-service;1"]
            .getService(Ci.nsIPrefBranch);

        // This path is intentionally retained for current Firefox builds.
        // Do not replace it with the obsolete XPCOM prompt-service lookup.
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

        const promptText = (title, message, initialValue = "") => {
            if (promptService?.prompt) {
                const input = { value: initialValue };
                const accepted = promptService.prompt(
                    window,
                    title,
                    message,
                    input,
                    null,
                    {}
                );

                return accepted ? input.value.trim() : null;
            }

            const value = window.prompt(message, initialValue);
            return value === null ? null : value.trim();
        };

        const alert = message => {
            if (promptService?.alert) {
                promptService.alert(window, "Extension Switchboard", message);
                return;
            }

            window.alert(message);
        };

        const confirm = (title, message) => {
            if (promptService?.confirm) {
                return promptService.confirm(window, title, message);
            }

            return window.confirm(message);
        };

        return {
            AddonManager,
            CustomizableUI,
            preferences,
            reportError,
            promptText,
            alert,
            confirm
        };
    })();

    const Dom = Object.freeze({
        create(tagName, options = {}) {
            const element = document.createElementNS(APP.HTML_NS, tagName);

            if (options.id) element.id = options.id;
            if (options.className) element.className = options.className;
            if (options.text !== undefined) element.textContent = options.text;

            for (const [name, value] of Object.entries(options.attributes ?? {})) {
                if (value !== null && value !== undefined && value !== false) {
                    element.setAttribute(name, value === true ? "" : String(value));
                }
            }

            Object.assign(element, options.properties ?? {});

            if (options.children?.length) {
                element.append(...options.children.filter(Boolean));
            }

            return element;
        },

        button(text, options = {}) {
            return this.create("button", {
                ...options,
                text,
                attributes: {
                    type: "button",
                    ...(options.attributes ?? {})
                }
            });
        },

        option(value, text) {
            return this.create("option", {
                text,
                attributes: { value }
            });
        }
    });

    const STYLE_TEXT = `
            #${APP.WIDGET_ID} {
                list-style-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cg fill='none' stroke='context-stroke' stroke-width='1.25'%3E%3Crect x='1.75' y='2.25' width='12.5' height='3.5' rx='1.75'/%3E%3Crect x='1.75' y='6.25' width='12.5' height='3.5' rx='1.75'/%3E%3Crect x='1.75' y='10.25' width='12.5' height='3.5' rx='1.75'/%3E%3C/g%3E%3Cg fill='context-fill'%3E%3Ccircle cx='4' cy='4' r='1.25'/%3E%3Ccircle cx='12' cy='8' r='1.25'/%3E%3Ccircle cx='6' cy='12' r='1.25'/%3E%3C/g%3E%3C/svg%3E");
                -moz-context-properties: fill, stroke;
                fill: currentColor;
                stroke: currentColor;
            }
            #${APP.PANEL_ID} {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: grid;
                place-items: center;
                background: rgb(0 0 0 / 45%);
                color-scheme: light dark;
                font: message-box;
            }
            #${APP.PANEL_ID} * { box-sizing: border-box; }
            #${APP.PANEL_ID} .sw-panel {
                width: min(780px, calc(100vw - 40px));
                height: min(700px, calc(100vh - 40px));
                display: grid;
                grid-template-rows: auto auto 1fr auto;
                overflow: hidden;
                border: 1px solid GrayText;
                border-radius: 10px;
                background: Canvas;
                color: CanvasText;
                box-shadow: 0 18px 60px rgb(0 0 0 / 45%);
            }
            #${APP.PANEL_ID} .sw-header,
            #${APP.PANEL_ID} .sw-toolbar,
            #${APP.PANEL_ID} .sw-footer { padding: 12px 14px; }
            #${APP.PANEL_ID} .sw-header,
            #${APP.PANEL_ID} .sw-toolbar { border-bottom: 1px solid GrayText; }
            #${APP.PANEL_ID} .sw-footer { border-top: 1px solid GrayText; }
            #${APP.PANEL_ID} .sw-header,
            #${APP.PANEL_ID} .sw-footer {
                display: flex;
                gap: 12px;
                align-items: flex-start;
                justify-content: space-between;
            }
            #${APP.PANEL_ID} .sw-header-actions {
                display: flex;
                flex: 0 0 auto;
                flex-wrap: wrap;
                gap: 8px;
                align-items: center;
                justify-content: flex-end;
            }
            #${APP.PANEL_ID} .sw-feedback {
                min-width: 0;
                flex: 1 1 auto;
            }
            #${APP.PANEL_ID} .sw-results[hidden] { display: none; }
            #${APP.PANEL_ID} .sw-results {
                max-height: 170px;
                overflow: auto;
                margin-top: 6px;
                font-size: 11px;
            }
            #${APP.PANEL_ID} .sw-results summary {
                cursor: pointer;
                font-weight: 600;
            }
            #${APP.PANEL_ID} .sw-result-group { margin-top: 6px; }
            #${APP.PANEL_ID} .sw-result-title { font-weight: 600; }
            #${APP.PANEL_ID} .sw-result-list {
                margin: 2px 0 0 18px;
                padding: 0;
            }
            #${APP.PANEL_ID} .sw-result-list li { margin-block: 2px; }
            #${APP.PANEL_ID} h1,
            #${APP.PANEL_ID} h2 { margin: 0; }
            #${APP.PANEL_ID} h1 { font-size: 18px; }
            #${APP.PANEL_ID} h2 { font-size: 14px; }
            #${APP.PANEL_ID} .sw-small {
                margin-top: 4px;
                font-size: 12px;
                opacity: .75;
            }
            #${APP.PANEL_ID} .sw-toolbar {
                display: flex;
                flex-wrap: wrap;
                gap: 10px 12px;
                align-items: center;
            }
            #${APP.PANEL_ID} .sw-show-firefox-disabled {
                display: none !important;
            }
            #${APP.PANEL_ID} .sw-shown {
                padding: 7px 8px;
                border-radius: var(--border-radius-medium);
                background-color: var(--button-background-color);
                font-weight: 600;
            }
            #${APP.PANEL_ID} input[type="search"] {
                flex: 1 1 320px;
                min-height: 34px;
                padding: 6px 10px;
            }
            #${APP.PANEL_ID} .sw-control {
                display: inline-flex;
                gap: 6px;
                align-items: center;
                font-size: 12px;
                white-space: nowrap;
            }
            #${APP.PANEL_ID} .sw-control select { min-height: 30px; }
            #${APP.PANEL_ID} .sw-main {
                min-height: 0;
                display: grid;
                grid-template-columns: 250px minmax(0, 1fr);
            }
            #${APP.PANEL_ID} .sw-categories {
                min-width: 0;
                min-height: 0;
                display: grid;
                grid-template-rows: auto minmax(0, 1fr);
                overflow: hidden;
                border-right: 1px solid GrayText;
                background: color-mix(in srgb, Canvas 94%, CanvasText 6%);
            }
            #${APP.PANEL_ID} .sw-category-header {
                display: grid;
                gap: 8px;
                padding: 12px;
                border-bottom: 1px solid GrayText;
            }
            #${APP.PANEL_ID} .sw-category-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            #${APP.PANEL_ID} .sw-category-actions button {
                min-height: 28px;
                padding: 3px 8px;
                font-size: 11px;
            }
            #${APP.PANEL_ID} .sw-category-list {
                min-height: 0;
                overflow-x: hidden;
                overflow-y: auto;
                padding-block: 5px;
            }
            #${APP.PANEL_ID} .sw-category-row {
                position: relative;
                display: grid;
                grid-template-columns: 24px minmax(0, 1fr) auto 20px;
                gap: 6px;
                align-items: center;
                min-height: 38px;
                padding-block: 4px;
                padding-inline: 6px 2px;
            }
            #${APP.PANEL_ID} .sw-category-row:hover,
            #${APP.PANEL_ID} .sw-category-row.selected {
                background: color-mix(in srgb, AccentColor 13%, transparent);
            }
            #${APP.PANEL_ID} .sw-category-row.selected {
                box-shadow: inset 3px 0 AccentColor;
            }
            #${APP.PANEL_ID} .sw-category-row.dragging {
                opacity: .55;
            }
            #${APP.PANEL_ID} .sw-category-row.drag-before::before,
            #${APP.PANEL_ID} .sw-category-row.drag-after::after {
                content: "";
                position: absolute;
                z-index: 1;
                right: 8px;
                left: 8px;
                height: 2px;
                border-radius: 2px;
                background: AccentColor;
                pointer-events: none;
            }
            #${APP.PANEL_ID} .sw-category-row.drag-before::before {
                top: -1px;
            }
            #${APP.PANEL_ID} .sw-category-row.drag-after::after {
                bottom: -1px;
            }
            #${APP.PANEL_ID} .sw-category-drag-handle,
            #${APP.PANEL_ID} .sw-category-drag-spacer {
                width: 20px;
                min-height: 28px;
            }
            #${APP.PANEL_ID} .sw-category-drag-handle {
                display: grid;
                place-items: center;
                opacity: .55;
                cursor: grab;
                font-size: 16px;
                line-height: 1;
                user-select: none;
            }
            #${APP.PANEL_ID} .sw-category-drag-handle:hover {
                opacity: 1;
            }
            #${APP.PANEL_ID} .sw-category-drag-handle:active {
                cursor: grabbing;
            }
            #${APP.PANEL_ID} .sw-category-drag-handle[aria-disabled="true"] {
                opacity: .25;
                cursor: not-allowed;
            }
            #${APP.PANEL_ID} .sw-category-name {
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
            #${APP.PANEL_ID} .sw-category-count {
                font-size: 10px;
                opacity: .68;
                white-space: nowrap;
            }
            #${APP.PANEL_ID} .sw-all-row {
                grid-template-columns: 24px 20px minmax(0, 1fr) auto;
            }
            #${APP.PANEL_ID} .sw-all-row .sw-all-spacer {
                width: 16px;
            }
            #${APP.PANEL_ID} .sw-extension-area {
                min-width: 0;
                min-height: 0;
                display: grid;
                grid-template-rows: 1fr;
            }
            #${APP.PANEL_ID} .sw-list { overflow: auto; padding-block: 5px; }
            #${APP.PANEL_ID} .sw-row {
                display: grid;
                grid-template-columns: 28px 32px minmax(0, 1fr) 165px;
                gap: 8px;
                align-items: center;
                min-height: 54px;
                padding: 6px 14px;
            }
            #${APP.PANEL_ID} .sw-icon {
                width: 32px;
                height: 32px;
                object-fit: contain;
                -moz-context-properties: fill, stroke;
                fill: currentColor;
                stroke: currentColor;
            }
            #${APP.PANEL_ID} .sw-row[hidden] { display: none; }
            #${APP.PANEL_ID} .sw-row:hover {
                background: color-mix(in srgb, AccentColor 10%, transparent);
            }
            #${APP.PANEL_ID} .sw-row.changed {
                background: color-mix(in srgb, AccentColor 17%, transparent);
            }
            #${APP.PANEL_ID} .sw-row.apply-failed .sw-scope {
                font-weight: 600;
                opacity: .9;
            }
            #${APP.PANEL_ID} .sw-name {
                overflow: hidden;
                font-weight: 600;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${APP.PANEL_ID} .sw-scope {
                overflow: hidden;
                margin-top: 2px;
                font-size: 11px;
                color: var(--text-color-deemphasized);
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            #${APP.PANEL_ID} .sw-scope strong {
                font-weight: 600;
                color: var(--color-accent-primary);
            }
            #${APP.PANEL_ID} .sw-category-select {
                width: 100%;
                min-width: 0;
                min-height: 30px;
            }
            #${APP.PANEL_ID} .sw-actions {
                display: flex;
                flex: 0 0 auto;
                flex-wrap: wrap;
                gap: 8px;
                justify-content: flex-end;
            }
            #${APP.PANEL_ID} button {
                min-height: 32px;
                padding: 5px 12px;
                border-width: 1px;
                border-radius: var(--border-radius-small);
                cursor: pointer;
            }
            #${APP.PANEL_ID} button:disabled,
            #${APP.PANEL_ID} input:disabled,
            #${APP.PANEL_ID} select:disabled {
                cursor: not-allowed;
                opacity: .55;
            }
            #${APP.PANEL_ID} .sw-close {
                min-width: 32px;
                padding-inline: 8px;
                font-size: 18px;
            }
            @media (max-width: 760px) {
                #${APP.PANEL_ID} .sw-panel {
                    width: calc(100vw - 20px);
                    height: min(700px, calc(100vh - 20px));
                }
                #${APP.PANEL_ID} .sw-main {
                    grid-template-columns: 200px minmax(0, 1fr);
                }
                #${APP.PANEL_ID} .sw-row {
                    grid-template-columns: 28px 28px minmax(0, 1fr) 130px;
                }
                #${APP.PANEL_ID} .sw-icon {
                    width: 28px;
                    height: 28px;
                }
            }
`;

    const StyleManager = Object.freeze({
        ensure() {
            const existing = document.getElementById(APP.STYLE_ID);
            if (existing?.dataset.version === APP.VERSION) return;
            existing?.remove();

            const style = Dom.create("style", {
                id: APP.STYLE_ID,
                text: STYLE_TEXT
            });
            style.dataset.version = APP.VERSION;
            document.documentElement.append(style);
        },

        remove() {
            document.getElementById(APP.STYLE_ID)?.remove();
        }
    });

    class ConfigStore {
        constructor(preferences) {
            this.preferences = preferences;
        }

        createDefault() {
            return {
                schemaVersion: APP.CONFIG_SCHEMA_VERSION,
                categories: [],
                assignments: {}
            };
        }

        normalizeCategoryName(name) {
            return name.trim().toLocaleLowerCase();
        }

        sanitize(value) {
            const sanitized = this.createDefault();
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
                const normalizedName = this.normalizeCategoryName(name);

                if (
                    !id ||
                    !name ||
                    id === APP.UNCATEGORIZED_ID ||
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
        }

        clone(config) {
            return {
                schemaVersion: config.schemaVersion ?? APP.CONFIG_SCHEMA_VERSION,
                categories: config.categories.map(category => ({ ...category })),
                assignments: { ...config.assignments }
            };
        }

        load() {
            try {
                const raw = this.preferences.getStringPref(APP.CONFIG_PREF, "");
                return raw
                    ? this.sanitize(JSON.parse(raw))
                    : this.createDefault();
            } catch (error) {
                FirefoxCompat.reportError(error);
                return this.createDefault();
            }
        }

        save(config) {
            this.preferences.setStringPref(
                APP.CONFIG_PREF,
                JSON.stringify(config)
            );
        }

        parseImport(rawText) {
            let parsed;

            try {
                parsed = JSON.parse(rawText);
            } catch {
                throw new Error("The selected file does not contain valid JSON.");
            }

            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error(
                    "The selected file is not an Extension Switchboard configuration."
                );
            }

            if (Object.hasOwn(parsed, "format")) {
                if (parsed.format !== APP.EXPORT_FORMAT) {
                    throw new Error(
                        "The selected JSON file uses an unrecognized configuration format."
                    );
                }

                if (Number(parsed.exportVersion ?? 0) > APP.EXPORT_VERSION) {
                    throw new Error(
                        "This configuration was created by a newer Extension Switchboard version."
                    );
                }

                parsed = parsed.config;
            }

            if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed) ||
                !Array.isArray(parsed.categories) ||
                !parsed.assignments ||
                typeof parsed.assignments !== "object" ||
                Array.isArray(parsed.assignments)
            ) {
                throw new Error(
                    "The selected JSON file does not contain categories and assignments."
                );
            }

            if (
                Number(parsed.schemaVersion ?? APP.CONFIG_SCHEMA_VERSION) >
                APP.CONFIG_SCHEMA_VERSION
            ) {
                throw new Error(
                    "This configuration schema is newer than the installed switchboard supports."
                );
            }

            const sanitized = this.sanitize(parsed);
            const importedCategoryCount = parsed.categories.length;
            const importedAssignmentCount = Object.keys(parsed.assignments).length;

            if (
                sanitized.categories.length !== importedCategoryCount ||
                Object.keys(sanitized.assignments).length !== importedAssignmentCount
            ) {
                throw new Error(
                    "The configuration contains invalid, duplicate, or orphaned category data."
                );
            }

            return sanitized;
        }

        createExportPayload(config, exportedAt = new Date()) {
            return {
                format: APP.EXPORT_FORMAT,
                exportVersion: APP.EXPORT_VERSION,
                exportedAt: exportedAt.toISOString(),
                config: this.clone(config)
            };
        }
    }

    class CategoryManager {
        constructor(configStore, config) {
            this.configStore = configStore;
            this.config = config;
        }

        replaceConfig(config) {
            this.config = config;
        }

        snapshot() {
            return this.configStore.clone(this.config);
        }

        createId() {
            if (typeof window.crypto?.randomUUID === "function") {
                return `category-${window.crypto.randomUUID()}`;
            }

            return `category-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`;
        }

        uncategorized() {
            return {
                id: APP.UNCATEGORIZED_ID,
                name: "Uncategorized",
                builtIn: true
            };
        }

        listForDisplay() {
            return [
                this.uncategorized(),
                ...this.config.categories.map(category => ({
                    ...category,
                    builtIn: false
                }))
            ];
        }

        getById(categoryId) {
            if (categoryId === APP.UNCATEGORIZED_ID) {
                return this.uncategorized();
            }

            const category = this.config.categories.find(
                item => item.id === categoryId
            );

            return category
                ? { ...category, builtIn: false }
                : this.uncategorized();
        }

        assignedId(extensionId) {
            const configuredId = this.config.assignments[extensionId];
            return this.config.categories.some(
                category => category.id === configuredId
            )
                ? configuredId
                : APP.UNCATEGORIZED_ID;
        }

        assign(extensionId, categoryId) {
            if (categoryId === APP.UNCATEGORIZED_ID) {
                delete this.config.assignments[extensionId];
                return;
            }

            if (!this.config.categories.some(category => category.id === categoryId)) {
                throw new Error("The selected category no longer exists.");
            }

            this.config.assignments[extensionId] = categoryId;
        }

        validateName(name, excludeId = null) {
            if (!name) return "A category name cannot be empty.";
            if (name.length > 80) {
                return "Category names are limited to 80 characters.";
            }

            const normalized = this.configStore.normalizeCategoryName(name);
            if (
                normalized ===
                    this.configStore.normalizeCategoryName("Uncategorized") ||
                this.config.categories.some(
                    category => category.id !== excludeId &&
                        this.configStore.normalizeCategoryName(category.name) ===
                            normalized
                )
            ) {
                return "That category name is already in use.";
            }

            return null;
        }

        create(name) {
            const error = this.validateName(name);
            if (error) throw new Error(error);

            const category = { id: this.createId(), name };
            this.config.categories.push(category);
            return category;
        }

        rename(categoryId, name) {
            const category = this.config.categories.find(
                item => item.id === categoryId
            );
            if (!category) throw new Error("The selected category no longer exists.");

            const error = this.validateName(name, categoryId);
            if (error) throw new Error(error);

            category.name = name;
            return category;
        }

        move(categoryId, targetCategoryId, position = "before") {
            if (!new Set(["before", "after"]).has(position)) {
                throw new Error("The requested category position is invalid.");
            }

            const sourceIndex = this.config.categories.findIndex(
                category => category.id === categoryId
            );
            const targetIndex = this.config.categories.findIndex(
                category => category.id === targetCategoryId
            );

            if (sourceIndex < 0 || targetIndex < 0) {
                throw new Error("One of the categories no longer exists.");
            }
            if (categoryId === targetCategoryId) return false;

            const previousOrder = this.config.categories.map(
                category => category.id
            );
            const [category] = this.config.categories.splice(sourceIndex, 1);
            const adjustedTargetIndex = this.config.categories.findIndex(
                item => item.id === targetCategoryId
            );
            const insertionIndex = adjustedTargetIndex +
                (position === "after" ? 1 : 0);

            this.config.categories.splice(insertionIndex, 0, category);

            return this.config.categories.some(
                (item, index) => item.id !== previousOrder[index]
            );
        }

        remove(categoryId) {
            const categoryIndex = this.config.categories.findIndex(
                item => item.id === categoryId
            );
            if (categoryIndex < 0) {
                throw new Error("The selected category no longer exists.");
            }

            const [category] = this.config.categories.splice(categoryIndex, 1);

            for (const [extensionId, assignedCategoryId] of Object.entries(
                this.config.assignments
            )) {
                if (assignedCategoryId === categoryId) {
                    delete this.config.assignments[extensionId];
                }
            }

            return category;
        }
    }

    class ExtensionService {
        constructor(addonManager) {
            this.addonManager = addonManager;
        }

        async listUserExtensions() {
            return (await this.addonManager.getAddonsByTypes(["extension"]))
                .filter(addon => !addon.hidden && !addon.isSystem);
        }

        async getById(id) {
            return this.addonManager.getAddonByID(id);
        }

        canToggle(addon) {
            if (addon.appDisabled) return false;

            const permission = addon.isActive
                ? this.addonManager.PERM_CAN_DISABLE
                : this.addonManager.PERM_CAN_ENABLE;

            return Boolean(addon.permissions & permission);
        }

        getIconURL(addon, size = 32) {
            try {
                return this.addonManager.getPreferredIconURL(
                    addon,
                    size,
                    window
                ) ?? FALLBACK_EXTENSION_ICON;
            } catch {
                return FALLBACK_EXTENSION_ICON;
            }
        }

        getSiteAccess(addon) {
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
                (originSet.has("http://*/*") && originSet.has("https://*/*"));

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
                title: "This extension does not have persistent or on-demand access to website content."
            };
        }

        async setActive(id, desiredActive) {
            const addon = await this.getById(id);
            if (!addon) throw new Error("Extension is no longer installed.");

            const previousActive = addon.isActive;

            if (desiredActive !== previousActive) {
                if (desiredActive) {
                    if (
                        addon.appDisabled ||
                        !(addon.permissions & this.addonManager.PERM_CAN_ENABLE)
                    ) {
                        throw new Error("Firefox does not permit enabling it.");
                    }
                    await addon.enable();
                } else {
                    if (!(addon.permissions & this.addonManager.PERM_CAN_DISABLE)) {
                        throw new Error("Firefox does not permit disabling it.");
                    }
                    await addon.disable();
                }
            }

            const updated = await this.getById(id);
            if (!updated) throw new Error("Extension disappeared afterward.");

            if (updated.isActive !== desiredActive) {
                throw new Error(
                    `Firefox reported the extension as ${
                        updated.isActive ? "enabled" : "disabled"
                    } after the operation.`
                );
            }

            return {
                previousActive,
                updated,
                changed: previousActive !== updated.isActive
            };
        }
    }

    class SwitchboardPanel {
        constructor({
            configStore,
            categoryManager,
            extensionService,
            getUndoSnapshot,
            setUndoSnapshot,
            onClose
        }) {
            this.configStore = configStore;
            this.categories = categoryManager;
            this.extensions = extensionService;
            this.getUndoSnapshot = getUndoSnapshot;
            this.setUndoSnapshot = setUndoSnapshot;
            this.onClose = onClose;

            this.busy = false;
            this.keepMessage = false;
            this.selectedCategoryId = null;
            this.draggedCategoryId = null;
            this.rows = [];
            this.categoryControls = [];
            this.ui = {};
        }

        async mount() {
            StyleManager.ensure();
            this.buildLayout();
            this.bindStaticEvents();
            await this.loadExtensionRows();
            this.rebuildCategoryList();
            this.renderRows();
            this.ui.search.focus();
        }

        close() {
            this.ui.overlay?.remove();
        }

        buildLayout() {
            const headingGroup = Dom.create("div", {
                children: [
                    Dom.create("h1", { text: `Extension Switchboard v${APP.VERSION}` }),
                    Dom.create("div", {
                        className: "sw-summary sw-small",
                        text: "Loading extensions…"
                    })
                ]
            });

            const exportButton = Dom.button("Export", {
                attributes: {
                    title: "Export categories and extension assignments as JSON"
                }
            });
            const importButton = Dom.button("Import", {
                attributes: {
                    title: "Replace categories and assignments from a JSON configuration file"
                }
            });
            const closeButton = Dom.button("×", {
                className: "sw-close",
                attributes: {
                    title: "Close",
                    "aria-label": "Close"
                }
            });
            const importFile = Dom.create("input", {
                attributes: {
                    type: "file",
                    accept: ".json,application/json",
                    hidden: "hidden",
                    "aria-hidden": "true"
                }
            });

            const header = Dom.create("div", {
                className: "sw-header",
                children: [
                    headingGroup,
                    Dom.create("div", {
                        className: "sw-header-actions",
                        children: [exportButton, importButton, closeButton]
                    }),
                    importFile
                ]
            });

            const search = Dom.create("input", {
                className: "sw-search",
                attributes: {
                    type: "search",
                    placeholder: "Filter by extension name, ID, or category…",
                    autocomplete: "off"
                }
            });
            const sort = Dom.create("select", {
                className: "sw-sort",
                attributes: { "aria-label": "Sort extensions" },
                children: [
                    Dom.option("name", "Name"),
                    Dom.option("active-first", "Enabled first"),
                    Dom.option("user-disabled-first", "Disabled first")
                ]
            });
            const showUnavailable = Dom.create("input", {
                attributes: { type: "checkbox" },
                properties: { checked: true }
            });
            const shown = Dom.create("div", {
                className: "sw-shown"
            });

            const toolbar = Dom.create("div", {
                className: "sw-toolbar",
                children: [
                    search,
                    Dom.create("label", {
                        className: "sw-control",
                        children: [Dom.create("span", { text: "Sort:" }), sort]
                    }),
                    Dom.create("label", {
                        className: "sw-control sw-show-firefox-disabled",
                        children: [
                            showUnavailable,
                            Dom.create("span", { text: "Show unavailable" })
                        ]
                    }),
                    shown
                ]
            });

            const addCategory = Dom.button("New", {
                attributes: { title: "Create category" }
            });
            const renameCategory = Dom.button("Rename", {
                attributes: { title: "Rename selected category" }
            });
            const deleteCategory = Dom.button("Delete", {
                attributes: { title: "Delete selected category" }
            });
            const categoryList = Dom.create("div", {
                className: "sw-category-list"
            });
            const categoriesArea = Dom.create("aside", {
                className: "sw-categories",
                children: [
                    Dom.create("div", {
                        className: "sw-category-header",
                        children: [
                            Dom.create("h2", { text: "Categories" }),
                            Dom.create("div", {
                                className: "sw-small",
                                text: "Toggle a category, or click its name to filter."
                            }),
                            Dom.create("div", {
                                className: "sw-category-actions",
                                children: [
                                    addCategory,
                                    renameCategory,
                                    deleteCategory
                                ]
                            })
                        ]
                    }),
                    categoryList
                ]
            });

            const extensionList = Dom.create("div", { className: "sw-list" });
            const main = Dom.create("div", {
                className: "sw-main",
                children: [
                    categoriesArea,
                    Dom.create("section", {
                        className: "sw-extension-area",
                        children: [extensionList]
                    })
                ]
            });

            const message = Dom.create("div", {
                className: "sw-message sw-small",
                text: "No unapplied changes."
            });
            const resultsSummary = Dom.create("summary", {
                text: "Operation details"
            });
            const resultsBody = Dom.create("div", {
                className: "sw-results-body"
            });
            const results = Dom.create("details", {
                className: "sw-results",
                properties: { hidden: true },
                children: [resultsSummary, resultsBody]
            });

            const resetButton = Dom.button("Reset", { className: "sw-reset" });
            const undoButton = Dom.button("Undo last apply", {
                className: "sw-undo",
                attributes: {
                    title: "Restore the extension states from immediately before the last successful Apply operation"
                },
                properties: { disabled: true }
            });
            const applyReloadButton = Dom.button("Apply and reload tab", {
                className: "sw-apply-reload",
                properties: { disabled: true }
            });
            const applyButton = Dom.button("Apply changes", {
                className: "sw-apply",
                properties: { disabled: true }
            });

            const footer = Dom.create("div", {
                className: "sw-footer",
                children: [
                    Dom.create("div", {
                        className: "sw-feedback",
                        children: [message, results]
                    }),
                    Dom.create("div", {
                        className: "sw-actions",
                        children: [
                            resetButton,
                            undoButton,
                            applyReloadButton,
                            applyButton
                        ]
                    })
                ]
            });

            const panel = Dom.create("div", {
                className: "sw-panel",
                attributes: {
                    role: "dialog",
                    "aria-label": "Extension Switchboard",
                    "aria-modal": "true"
                },
                children: [header, toolbar, main, footer]
            });
            const overlay = Dom.create("div", {
                id: APP.PANEL_ID,
                attributes: {
                    tabindex: "-1"
                },
                children: [panel]
            });
            document.documentElement.append(overlay);

            // focus on the overlay, defering by one animation frame to ensure the layout is finished
            window.requestAnimationFrame(() => {
                overlay.focus({
                    preventScroll: true
                });
            });

            this.ui = {
                overlay,
                panel,
                summary: headingGroup.querySelector(".sw-summary"),
                exportButton,
                importButton,
                importFile,
                closeButton,
                search,
                sort,
                showUnavailable,
                shown,
                addCategory,
                renameCategory,
                deleteCategory,
                categoryList,
                extensionList,
                message,
                results,
                resultsSummary,
                resultsBody,
                resetButton,
                undoButton,
                applyReloadButton,
                applyButton
            };
        }

        bindStaticEvents() {
            const ui = this.ui;

            ui.search.addEventListener("input", () => this.renderRows());
            ui.sort.addEventListener("change", () => this.renderRows());
            ui.showUnavailable.addEventListener("change", () => this.renderRows());

            ui.addCategory.addEventListener("click", () => this.createCategory());
            ui.renameCategory.addEventListener("click", () => this.renameCategory());
            ui.deleteCategory.addEventListener("click", () => this.deleteCategory());

            ui.exportButton.addEventListener("click", () => {
                try {
                    this.exportConfiguration();
                } catch (error) {
                    FirefoxCompat.reportError(error);
                    this.keepMessage = true;
                    ui.message.textContent =
                        "Configuration export failed. See Browser Console.";
                }
            });

            ui.importButton.addEventListener("click", () => ui.importFile.click());
            ui.importFile.addEventListener("change", () => {
                this.importConfiguration().catch(FirefoxCompat.reportError);
            });

            ui.resetButton.addEventListener("click", () => {
                this.resetToLiveState().catch(FirefoxCompat.reportError);
            });
            ui.applyButton.addEventListener("click", () => {
                this.performApply().catch(FirefoxCompat.reportError);
            });
            ui.applyReloadButton.addEventListener("click", () => {
                this.performApply({ reloadCurrentTab: true })
                    .catch(FirefoxCompat.reportError);
            });
            ui.undoButton.addEventListener("click", () => {
                this.undoLastApply().catch(FirefoxCompat.reportError);
            });

            const handleClose = () => {
                if (!this.busy) this.onClose();
            };

            ui.closeButton.addEventListener("click", handleClose);
            ui.overlay.addEventListener("click", event => {
                if (event.target === ui.overlay) handleClose();
            });
            ui.overlay.addEventListener("keydown", event => {
                if (event.key === "Escape") handleClose();
            });
        }

        async loadExtensionRows() {
            const addons = await this.extensions.listUserExtensions();

            for (const addon of addons) {
                const row = this.createExtensionRow(addon);
                this.rows.push(row);
                this.ui.extensionList.append(row.element);
            }
        }

        createExtensionRow(addon) {
            const checkbox = Dom.create("input", {
                attributes: { type: "checkbox" },
                properties: {
                    checked: addon.isActive,
                    disabled: !this.extensions.canToggle(addon)
                }
            });
            const iconURL = this.extensions.getIconURL(addon);
            const icon = Dom.create("img", {
                className: "sw-icon",
                attributes: {
                    src: iconURL,
                    alt: "",
                    "aria-hidden": "true"
                },
                properties: { draggable: false }
            });
            icon.addEventListener("error", () => {
                icon.src = FALLBACK_EXTENSION_ICON;
            }, { once: true });

            const siteAccess = this.extensions.getSiteAccess(addon);
            const scope = Dom.create("div", {
                className: "sw-scope"
            });

            const categorySelect = Dom.create("select", {
                className: "sw-category-select",
                attributes: {
                    "aria-label": `Category for ${addon.name}`,
                    title: "Assign this extension to one category"
                }
            });
            const element = Dom.create("div", {
                className: "sw-row",
                children: [
                    checkbox,
                    icon,
                    Dom.create("div", {
                        children: [
                            Dom.create("div", {
                                className: "sw-name",
                                text: addon.name,
                                attributes: { title: `Extension ID: ${addon.id}` }
                            }),
                            scope
                        ]
                    }),
                    categorySelect
                ]
            });

            const row = {
                id: addon.id,
                name: addon.name,
                searchText: "",
                currentActive: addon.isActive,
                currentUserDisabled: addon.userDisabled,
                appDisabled: addon.appDisabled,
                locked: !this.extensions.canToggle(addon),
                iconURL,
                siteAccess,
                lastError: null,
                checkbox,
                icon,
                categorySelect,
                scope,
                element
            };

            this.updateRowScope(row);
            this.updateRowStateClasses(row);
            this.updateRowChangeState(row);
            this.rebuildCategorySelect(row);

            checkbox.addEventListener("change", () => {
                row.lastError = null;
                this.updateRowScope(row);
                this.updateRowChangeState(row);
                this.keepMessage = false;
                this.updateCategoryStates();
                this.updateCounts();
            });

            categorySelect.addEventListener("change", () => {
                this.changeRowCategory(row);
            });

            return row;
        }

        clearOperationResults() {
            this.ui.results.hidden = true;
            this.ui.results.open = false;
            this.ui.resultsBody.replaceChildren();
        }

        appendResultGroup(title, entries, formatter = value => value) {
            if (!entries.length) return;

            this.ui.resultsBody.append(Dom.create("div", {
                className: "sw-result-group",
                children: [
                    Dom.create("div", {
                        className: "sw-result-title",
                        text: `${title} (${entries.length})`
                    }),
                    Dom.create("ul", {
                        className: "sw-result-list",
                        children: entries.map(entry => Dom.create("li", {
                            text: formatter(entry)
                        }))
                    })
                ]
            }));
        }

        showOperationResults({ enabled, disabled, failures }) {
            this.ui.resultsBody.replaceChildren();
            this.appendResultGroup("Enabled", enabled);
            this.appendResultGroup("Disabled", disabled);
            this.appendResultGroup(
                "Failed",
                failures,
                failure => `${failure.name}: ${failure.error}`
            );

            const total = enabled.length + disabled.length + failures.length;
            this.ui.results.hidden = total === 0;
            this.ui.results.open = failures.length > 0;
            this.ui.resultsSummary.textContent = failures.length
                ? `Operation details · ${failures.length} failed`
                : "Operation details";
        }

        persistOrRollback(snapshot) {
            try {
                this.configStore.save(this.categories.config);
                return true;
            } catch (error) {
                this.categories.replaceConfig(snapshot);
                FirefoxCompat.reportError(error);
                this.ui.message.textContent =
                    "Category configuration could not be saved. See Browser Console.";
                this.keepMessage = true;
                return false;
            }
        }

        exportConfiguration() {
            const exportedAt = new Date();
            const datePart = [
                exportedAt.getFullYear(),
                String(exportedAt.getMonth() + 1).padStart(2, "0"),
                String(exportedAt.getDate()).padStart(2, "0")
            ].join("-");
            const payload = this.configStore.createExportPayload(
                this.categories.config,
                exportedAt
            );
            const blob = new Blob(
                [`${JSON.stringify(payload, null, 2)}\n`],
                { type: "application/json" }
            );
            const url = URL.createObjectURL(blob);
            const anchor = Dom.create("a", {
                attributes: {
                    href: url,
                    download: `ExtensionSwitchboard-${datePart}.json`,
                    hidden: "hidden"
                }
            });

            document.documentElement.append(anchor);
            anchor.click();
            window.setTimeout(() => {
                URL.revokeObjectURL(url);
                anchor.remove();
            }, 0);

            const categoryCount = this.categories.config.categories.length;
            const assignmentCount = Object.keys(
                this.categories.config.assignments
            ).length;
            this.keepMessage = true;
            this.ui.message.textContent =
                `Exported ${categoryCount} user categor${
                    categoryCount === 1 ? "y" : "ies"
                } and ${assignmentCount} assignment${
                    assignmentCount === 1 ? "" : "s"
                }.`;
        }

        async importConfiguration() {
            const file = this.ui.importFile.files?.[0] ?? null;
            this.ui.importFile.value = "";
            if (!file) return;

            let importedConfig;
            try {
                importedConfig = this.configStore.parseImport(await file.text());
            } catch (error) {
                FirefoxCompat.reportError(error);
                FirefoxCompat.alert(
                    error instanceof Error
                        ? error.message
                        : "The configuration could not be imported."
                );
                return;
            }

            const categoryCount = importedConfig.categories.length;
            const assignmentCount = Object.keys(importedConfig.assignments).length;
            const confirmed = FirefoxCompat.confirm(
                "Import configuration",
                "Replace the current categories and assignments with " +
                `the configuration from “${file.name}”?\n\n` +
                `${categoryCount} user categor${
                    categoryCount === 1 ? "y" : "ies"
                } and ${assignmentCount} extension assignment${
                    assignmentCount === 1 ? "" : "s"
                } will be imported. Extension enabled/disabled states will not change.`
            );
            if (!confirmed) return;

            const snapshot = this.categories.snapshot();
            this.categories.replaceConfig(importedConfig);
            if (!this.persistOrRollback(snapshot)) return;

            this.selectedCategoryId = null;
            this.clearOperationResults();
            this.rebuildAllCategorySelects();
            this.rebuildCategoryList();
            this.renderRows();
            this.keepMessage = true;
            this.ui.message.textContent =
                `Imported ${categoryCount} user categor${
                    categoryCount === 1 ? "y" : "ies"
                } and ${assignmentCount} assignment${
                    assignmentCount === 1 ? "" : "s"
                }. Extension states were left unchanged.`;
        }

        updateCategorySelectionControls() {
            const selected = this.categories.getById(this.selectedCategoryId);
            const editable = this.selectedCategoryId !== null && !selected.builtIn;

            this.ui.renameCategory.disabled = this.busy || !editable;
            this.ui.deleteCategory.disabled = this.busy || !editable;
            this.ui.addCategory.disabled = this.busy;
            this.ui.exportButton.disabled = this.busy;
            this.ui.importButton.disabled = this.busy;
        }

        updateCounts() {
            const active = this.rows.filter(row => row.currentActive).length;
            const unavailable = this.rows.filter(row => row.appDisabled).length;
            const changed = this.rows.filter(
                row => row.checkbox.checked !== row.currentActive
            ).length;
            const visible = this.rows.filter(row => !row.element.hidden).length;
            const changeLabel = changed === 1 ? "change" : "changes";
            const undoCount = this.getUndoSnapshot()?.entries?.length ?? 0;

            this.ui.summary.textContent =
                `${this.categories.config.categories.length + 1} categories · ` +
                `${this.rows.length} extensions · ${active} enabled · ` +
                `${unavailable} unavailable`;
            this.ui.shown.textContent = `${visible} shown`;

            this.ui.applyButton.disabled = this.busy || changed === 0;
            this.ui.applyReloadButton.disabled = this.busy || changed === 0;
            this.ui.applyButton.textContent = changed
                ? `Apply ${changed} ${changeLabel}`
                : "Apply changes";
            this.ui.applyReloadButton.textContent = changed
                ? `Apply ${changed} ${changeLabel} and reload tab`
                : "Apply and reload tab";

            this.ui.undoButton.disabled = this.busy || undoCount === 0;
            this.ui.undoButton.textContent = undoCount
                ? `Undo last apply (${undoCount})`
                : "Undo last apply";

            if (!this.busy && changed === 0 && !this.keepMessage) {
                this.ui.message.textContent = "No unapplied changes.";
            }
        }

        updateRowStateClasses(row) {
            row.element.classList.toggle("active", row.currentActive);
            row.element.classList.toggle(
                "user-disabled",
                row.currentUserDisabled
            );
            row.element.classList.toggle("firefox-disabled", row.appDisabled);
        }

        updateCheckboxDescription(row) {
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
        }

        updateRowChangeState(row) {
            row.element.classList.toggle(
                "changed",
                row.checkbox.checked !== row.currentActive
            );
            this.updateCheckboxDescription(row);
        }

        updateRowScope(row) {
            const children = [];

            if (row.appDisabled) {
                children.push(
                    Dom.create("strong", { text: "Disabled by Firefox" }),
                    document.createTextNode(" · ")
                );
            }

            children.push(
                document.createTextNode("Access: "),
                Dom.create("strong", { text: row.siteAccess.label })
            );

            if (row.lastError) {
                children.push(
                    document.createTextNode(" · "),
                    Dom.create("strong", { text: "Operation failed:" }),
                    document.createTextNode(` ${row.lastError}`)
                );
            }

            row.scope.replaceChildren(...children);
            row.scope.title = row.lastError
                ? `${row.siteAccess.title}\n\nLast operation failed: ${row.lastError}`
                : row.siteAccess.title;
            row.element.classList.toggle("apply-failed", Boolean(row.lastError));
        }

        updateRow(
            row,
            addon,
            { preserveDesired = false, clearFailure = true } = {}
        ) {
            row.currentActive = addon.isActive;
            row.currentUserDisabled = addon.userDisabled;
            row.appDisabled = addon.appDisabled;
            row.locked = !this.extensions.canToggle(addon);

            const iconURL = this.extensions.getIconURL(addon);
            if (iconURL !== row.iconURL) {
                row.iconURL = iconURL;
                row.icon.src = iconURL;
            }

            row.siteAccess = this.extensions.getSiteAccess(addon);

            if (!preserveDesired) row.checkbox.checked = addon.isActive;
            if (clearFailure) row.lastError = null;

            row.checkbox.disabled = this.busy || row.locked;
            this.updateRowScope(row);
            this.updateRowStateClasses(row);
            this.updateRowChangeState(row);
            this.updateRowSearchText(row);
        }

        markRowFailure(row, error) {
            row.lastError = error instanceof Error ? error.message : String(error);
            this.updateRowScope(row);
            this.updateRowChangeState(row);
        }

        updateRowSearchText(row) {
            const categoryName = this.categories.getById(
                this.categories.assignedId(row.id)
            ).name;
            row.searchText = `${row.name}\n${row.id}\n${categoryName}\n${
                row.siteAccess.label
            }`.toLocaleLowerCase();
        }

        rebuildCategorySelect(row) {
            const selectedId = this.categories.assignedId(row.id);
            row.categorySelect.replaceChildren(
                ...this.categories.listForDisplay().map(category =>
                    Dom.option(category.id, category.name)
                )
            );
            row.categorySelect.value = selectedId;
            row.categorySelect.disabled = this.busy;
            this.updateRowSearchText(row);
        }

        rebuildAllCategorySelects() {
            for (const row of this.rows) this.rebuildCategorySelect(row);
        }

        clearCategoryDropIndicators(exceptElement = null) {
            for (const control of this.categoryControls) {
                if (control.element !== exceptElement) {
                    control.element.classList.remove("drag-before", "drag-after");
                }
            }
        }

        clearCategoryDragState() {
            this.draggedCategoryId = null;
            for (const control of this.categoryControls) {
                control.element.classList.remove(
                    "dragging",
                    "drag-before",
                    "drag-after"
                );
            }
        }

        getCategoryDropPosition(event, element) {
            const bounds = element.getBoundingClientRect();
            return event.clientY < bounds.top + bounds.height / 2
                ? "before"
                : "after";
        }

        autoScrollCategoryList(event) {
            const bounds = this.ui.categoryList.getBoundingClientRect();
            const edgeSize = Math.min(36, bounds.height / 4);
            const scrollAmount = 18;

            if (event.clientY < bounds.top + edgeSize) {
                this.ui.categoryList.scrollBy(0, -scrollAmount);
            } else if (event.clientY > bounds.bottom - edgeSize) {
                this.ui.categoryList.scrollBy(0, scrollAmount);
            }
        }

        moveCategory(categoryId, targetCategoryId, position) {
            const snapshot = this.categories.snapshot();
            const categoryName = this.categories.getById(categoryId).name;
            let moved;

            try {
                moved = this.categories.move(
                    categoryId,
                    targetCategoryId,
                    position
                );
            } catch (error) {
                FirefoxCompat.alert(error.message);
                return;
            }

            if (!moved) return;

            if (!this.persistOrRollback(snapshot)) {
                this.rebuildAllCategorySelects();
                this.rebuildCategoryList();
                this.renderRows();
                return;
            }

            this.rebuildAllCategorySelects();
            this.rebuildCategoryList();
            this.renderRows();
            this.keepMessage = true;
            this.ui.message.textContent = `Moved category “${categoryName}”.`;
        }

        updateCategoryStates() {
            for (const control of this.categoryControls) {
                const members = this.rows.filter(
                    row => this.categories.assignedId(row.id) === control.categoryId
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
                control.checkbox.disabled =
                    this.busy || toggleableMembers.length === 0;

                const unavailable = members.length - toggleableMembers.length;
                control.count.textContent = unavailable
                    ? `${enabled}/${toggleableMembers.length} · ${unavailable} unavailable`
                    : `${enabled}/${toggleableMembers.length}`;
                control.element.classList.toggle(
                    "selected",
                    this.selectedCategoryId === control.categoryId
                );
                control.nameButton.disabled = this.busy;

                if (control.dragHandle) {
                    control.dragHandle.draggable = !this.busy;
                    control.dragHandle.setAttribute(
                        "aria-disabled",
                        String(this.busy)
                    );
                }
            }

            this.updateCategorySelectionControls();
        }

        setBusy(value) {
            this.busy = value;

            for (const control of [
                this.ui.search,
                this.ui.sort,
                this.ui.showUnavailable,
                this.ui.resetButton,
                this.ui.closeButton
            ]) {
                control.disabled = value;
            }

            for (const row of this.rows) {
                row.checkbox.disabled = value || row.locked;
                row.categorySelect.disabled = value;
            }

            this.updateCategoryStates();
            this.updateCounts();
        }

        compareRows(a, b) {
            if (a.appDisabled !== b.appDisabled) return a.appDisabled ? 1 : -1;

            switch (this.ui.sort.value) {
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

            return a.name.localeCompare(b.name, undefined, {
                sensitivity: "base"
            });
        }

        renderRows() {
            const query = this.ui.search.value.trim().toLocaleLowerCase();

            for (const row of [...this.rows].sort((a, b) => this.compareRows(a, b))) {
                const hiddenBySearch = Boolean(query) &&
                    !row.searchText.includes(query);
                const hiddenByFirefoxState = row.appDisabled &&
                    !this.ui.showUnavailable.checked;
                const hiddenByCategory = this.selectedCategoryId !== null &&
                    this.categories.assignedId(row.id) !== this.selectedCategoryId;

                row.element.hidden =
                    hiddenBySearch || hiddenByFirefoxState || hiddenByCategory;
                this.ui.extensionList.append(row.element);
            }

            this.updateCategoryStates();
            this.updateCounts();
        }

        rebuildCategoryList() {
            this.clearCategoryDragState();
            this.ui.categoryList.replaceChildren();
            this.categoryControls.length = 0;

            const allName = Dom.button("All extensions", {
                className: "sw-category-name"
            });
            allName.disabled = this.busy;
            allName.addEventListener("click", () => {
                this.selectedCategoryId = null;
                this.rebuildCategoryList();
                this.renderRows();
            });

            const allRow = Dom.create("div", {
                className: "sw-category-row sw-all-row",
                children: [
                    Dom.create("span", { className: "sw-all-spacer" }),
                    allName,
                    Dom.create("span", {
                        className: "sw-category-count",
                        text: String(this.rows.length)
                    }),
                    Dom.create("span", { className: "sw-category-drag-spacer" })
                ]
            });
            allRow.classList.toggle("selected", this.selectedCategoryId === null);
            this.ui.categoryList.append(allRow);

            for (const category of this.categories.listForDisplay()) {
                const checkbox = Dom.create("input", {
                    attributes: {
                        type: "checkbox",
                        title: `Enable or disable all toggleable extensions in ${category.name}`,
                        "aria-label": `Toggle category ${category.name}`
                    }
                });
                const dragHandle = category.builtIn
                    ? Dom.create("span", {
                        className: "sw-category-drag-spacer",
                        attributes: { "aria-hidden": "true" }
                    })
                    : Dom.create("span", {
                        className: "sw-category-drag-handle",
                        text: "⠿",
                        attributes: {
                            role: "button",
                            title: `Drag to reorder ${category.name}`,
                            "aria-label": `Drag to reorder category ${category.name}`,
                            "aria-disabled": String(this.busy)
                        },
                        properties: { draggable: !this.busy }
                    });
                const nameButton = Dom.button(category.name, {
                    className: "sw-category-name",
                    attributes: {
                        title: `Show only extensions in ${category.name}`
                    }
                });
                const count = Dom.create("span", {
                    className: "sw-category-count"
                });
                const element = Dom.create("div", {
                    className: "sw-category-row",
                    children: [checkbox, nameButton, count, dragHandle]
                });

                checkbox.addEventListener("change", () => {
                    const desiredState = checkbox.checked;
                    for (const row of this.rows) {
                        if (
                            this.categories.assignedId(row.id) === category.id &&
                            !row.locked
                        ) {
                            row.checkbox.checked = desiredState;
                            row.lastError = null;
                            this.updateRowScope(row);
                            this.updateRowChangeState(row);
                        }
                    }
                    this.keepMessage = false;
                    this.updateCategoryStates();
                    this.updateCounts();
                });

                nameButton.addEventListener("click", () => {
                    this.selectedCategoryId = category.id;
                    this.rebuildCategoryList();
                    this.renderRows();
                });

                if (!category.builtIn) {
                    dragHandle.addEventListener("dragstart", event => {
                        if (this.busy) {
                            event.preventDefault();
                            return;
                        }

                        this.draggedCategoryId = category.id;
                        element.classList.add("dragging");

                        if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", category.id);
                            event.dataTransfer.setDragImage(element, 20, 20);
                        }
                    });

                    dragHandle.addEventListener("dragend", () => {
                        this.clearCategoryDragState();
                    });

                    element.addEventListener("dragover", event => {
                        if (
                            this.busy ||
                            !this.draggedCategoryId ||
                            this.draggedCategoryId === category.id
                        ) {
                            return;
                        }

                        event.preventDefault();
                        if (event.dataTransfer) {
                            event.dataTransfer.dropEffect = "move";
                        }

                        this.autoScrollCategoryList(event);
                        const position = this.getCategoryDropPosition(
                            event,
                            element
                        );
                        this.clearCategoryDropIndicators(element);
                        element.classList.toggle(
                            "drag-before",
                            position === "before"
                        );
                        element.classList.toggle(
                            "drag-after",
                            position === "after"
                        );
                    });

                    element.addEventListener("dragleave", event => {
                        if (
                            event.relatedTarget &&
                            element.contains(event.relatedTarget)
                        ) {
                            return;
                        }

                        element.classList.remove("drag-before", "drag-after");
                    });

                    element.addEventListener("drop", event => {
                        if (
                            this.busy ||
                            !this.draggedCategoryId ||
                            this.draggedCategoryId === category.id
                        ) {
                            return;
                        }

                        event.preventDefault();
                        const draggedCategoryId = this.draggedCategoryId;
                        const position = this.getCategoryDropPosition(
                            event,
                            element
                        );
                        this.clearCategoryDragState();
                        this.moveCategory(
                            draggedCategoryId,
                            category.id,
                            position
                        );
                    });
                }

                this.ui.categoryList.append(element);
                this.categoryControls.push({
                    categoryId: category.id,
                    checkbox,
                    nameButton,
                    count,
                    dragHandle: category.builtIn ? null : dragHandle,
                    element
                });
            }

            this.updateCategoryStates();
        }

        changeRowCategory(row) {
            const snapshot = this.categories.snapshot();
            const newCategoryId = row.categorySelect.value;

            try {
                this.categories.assign(row.id, newCategoryId);
            } catch (error) {
                FirefoxCompat.alert(error.message);
                this.rebuildCategorySelect(row);
                return;
            }

            if (!this.persistOrRollback(snapshot)) {
                this.rebuildAllCategorySelects();
                this.rebuildCategoryList();
                this.renderRows();
                return;
            }

            this.updateRowSearchText(row);
            this.keepMessage = true;
            this.ui.message.textContent =
                `Assigned “${row.name}” to ${
                    this.categories.getById(newCategoryId).name
                }.`;
            this.rebuildCategoryList();
            this.renderRows();
        }

        createCategory() {
            const name = FirefoxCompat.promptText(
                "Create category",
                "Enter a name for the new category:"
            );
            if (name === null) return;

            const snapshot = this.categories.snapshot();
            try {
                this.categories.create(name);
            } catch (error) {
                FirefoxCompat.alert(error.message);
                return;
            }

            if (!this.persistOrRollback(snapshot)) return;

            this.selectedCategoryId = APP.UNCATEGORIZED_ID;
            this.rebuildAllCategorySelects();
            this.rebuildCategoryList();
            this.renderRows();
            this.keepMessage = true;
            this.ui.message.textContent =
                `Created category “${name}”. Showing Uncategorized extensions.`;
        }

        renameCategory() {
            const category = this.categories.config.categories.find(
                item => item.id === this.selectedCategoryId
            );
            if (!category) return;

            const name = FirefoxCompat.promptText(
                "Rename category",
                "Enter a new category name:",
                category.name
            );
            if (name === null || name === category.name) return;

            const snapshot = this.categories.snapshot();
            try {
                this.categories.rename(category.id, name);
            } catch (error) {
                FirefoxCompat.alert(error.message);
                return;
            }

            if (!this.persistOrRollback(snapshot)) return;

            this.rebuildAllCategorySelects();
            this.rebuildCategoryList();
            this.renderRows();
            this.keepMessage = true;
            this.ui.message.textContent = `Renamed category to “${name}”.`;
        }

        deleteCategory() {
            const category = this.categories.config.categories.find(
                item => item.id === this.selectedCategoryId
            );
            if (!category) return;

            const assignedRows = this.rows.filter(
                row => this.categories.assignedId(row.id) === category.id
            );
            const confirmed = FirefoxCompat.confirm(
                "Delete category",
                `Delete “${category.name}”?\n\n` +
                `${assignedRows.length} extension(s) will be moved to Uncategorized.`
            );
            if (!confirmed) return;

            const snapshot = this.categories.snapshot();
            try {
                this.categories.remove(category.id);
            } catch (error) {
                FirefoxCompat.alert(error.message);
                return;
            }

            if (!this.persistOrRollback(snapshot)) return;

            this.selectedCategoryId = APP.UNCATEGORIZED_ID;
            this.rebuildAllCategorySelects();
            this.rebuildCategoryList();
            this.renderRows();
            this.keepMessage = true;
            this.ui.message.textContent =
                `Deleted “${category.name}”; its extensions are now Uncategorized.`;
        }

        async refreshRows({ preserveDesired = false } = {}) {
            for (const row of this.rows) {
                const addon = await this.extensions.getById(row.id);
                if (addon) this.updateRow(row, addon, { preserveDesired });
            }
            this.renderRows();
        }

        async resetToLiveState() {
            this.keepMessage = true;
            this.clearOperationResults();
            this.ui.message.textContent = "Refreshing current extension states…";
            this.setBusy(true);

            try {
                await this.refreshRows();
                this.ui.message.textContent =
                    "Extension selections reset to the current live state.";
            } catch (error) {
                FirefoxCompat.reportError(error);
                this.ui.message.textContent =
                    "Refresh failed. See Browser Console.";
            } finally {
                this.setBusy(false);
            }
        }

        async refreshFailedRow(row, { preserveDesired = true } = {}) {
            try {
                const current = await this.extensions.getById(row.id);
                if (current) {
                    this.updateRow(row, current, {
                        preserveDesired,
                        clearFailure: false
                    });
                }
            } catch (error) {
                FirefoxCompat.reportError(error);
            }
        }

        failureFor(rowOrEntry, error) {
            return {
                name: rowOrEntry.name,
                id: rowOrEntry.id,
                error: error instanceof Error ? error.message : String(error)
            };
        }

        async performApply({ reloadCurrentTab = false } = {}) {
            const changes = this.rows.filter(
                row => row.checkbox.checked !== row.currentActive
            );
            if (!changes.length) return;

            const browserToReload = reloadCurrentTab
                ? window.gBrowser?.selectedBrowser ?? null
                : null;

            this.keepMessage = true;
            this.clearOperationResults();
            this.ui.message.textContent = `Applying ${changes.length} change(s)…`;
            this.setBusy(true);

            const enabled = [];
            const disabled = [];
            const failures = [];
            const undoEntries = [];

            for (const row of changes) {
                const desiredActive = row.checkbox.checked;

                try {
                    const result = await this.extensions.setActive(
                        row.id,
                        desiredActive
                    );

                    if (result.changed) {
                        undoEntries.push({
                            id: row.id,
                            name: row.name,
                            active: result.previousActive
                        });
                        (result.updated.isActive ? enabled : disabled).push(row.name);
                    }

                    this.updateRow(row, result.updated);
                } catch (error) {
                    const failure = this.failureFor(row, error);
                    failures.push(failure);
                    await this.refreshFailedRow(row);
                    this.markRowFailure(row, failure.error);
                }
            }

            if (undoEntries.length) {
                this.setUndoSnapshot({
                    createdAt: Date.now(),
                    entries: undoEntries
                });
            }

            this.setBusy(false);
            this.showOperationResults({ enabled, disabled, failures });

            const applied = enabled.length + disabled.length;
            if (failures.length) {
                this.ui.message.textContent =
                    `${applied} applied; ${failures.length} failed. ` +
                    "Failed changes remain pending.";
                console.table(failures);
            } else if (applied) {
                this.ui.message.textContent =
                    `${enabled.length} enabled; ${disabled.length} disabled.`;
            } else {
                this.ui.message.textContent =
                    "No extension state changes were necessary.";
            }

            this.renderRows();

            if (reloadCurrentTab && applied > 0) {
                try {
                    if (
                        !browserToReload ||
                        typeof browserToReload.reload !== "function"
                    ) {
                        throw new Error("No reloadable current tab was found.");
                    }
                    browserToReload.reload();
                    this.ui.message.textContent += " Current tab reloaded.";
                } catch (error) {
                    FirefoxCompat.reportError(error);
                    this.ui.message.textContent +=
                        " The current tab could not be reloaded.";
                }
            }
        }

        async undoLastApply() {
            const snapshot = this.getUndoSnapshot();
            if (!snapshot?.entries?.length) return;

            this.keepMessage = true;
            this.clearOperationResults();
            this.ui.message.textContent =
                `Restoring ${snapshot.entries.length} previous state(s)…`;
            this.setBusy(true);

            const enabled = [];
            const disabled = [];
            const failures = [];
            const remainingEntries = [];

            for (const entry of snapshot.entries) {
                const row = this.rows.find(candidate => candidate.id === entry.id);
                const hadPendingSelection = Boolean(
                    row && row.checkbox.checked !== row.currentActive
                );

                try {
                    const result = await this.extensions.setActive(
                        entry.id,
                        entry.active
                    );
                    if (result.changed) {
                        (result.updated.isActive ? enabled : disabled).push(entry.name);
                    }
                    if (row) {
                        this.updateRow(row, result.updated, {
                            preserveDesired: hadPendingSelection
                        });
                    }
                } catch (error) {
                    const failure = this.failureFor(entry, error);
                    failures.push(failure);
                    remainingEntries.push(entry);

                    if (row) {
                        await this.refreshFailedRow(row);
                        if (!hadPendingSelection) row.checkbox.checked = entry.active;
                        this.markRowFailure(row, failure.error);
                    }
                }
            }

            this.setUndoSnapshot(
                remainingEntries.length
                    ? { ...snapshot, entries: remainingEntries }
                    : null
            );

            this.setBusy(false);
            this.showOperationResults({ enabled, disabled, failures });

            const restored = enabled.length + disabled.length;
            this.ui.message.textContent = failures.length
                ? `${restored} restored; ${failures.length} failed. ` +
                    "Failed undo changes remain available for retry."
                : restored
                    ? `${restored} extension state(s) restored.`
                    : "The previous extension states were already restored.";

            if (failures.length) console.table(failures);
            this.renderRows();
        }
    }

    class SwitchboardController {
        constructor() {
            this.configStore = new ConfigStore(FirefoxCompat.preferences);
            this.extensionService = new ExtensionService(
                FirefoxCompat.AddonManager
            );
            this.panel = null;
            this.lastApplySnapshot = null;
        }

        ensureWidget() {
            const existingWidget = FirefoxCompat.CustomizableUI.getWidget(
                APP.WIDGET_ID
            );

            if (
                existingWidget?.provider ===
                FirefoxCompat.CustomizableUI.PROVIDER_API
            ) {
                return;
            }

            FirefoxCompat.CustomizableUI.createWidget({
                id: APP.WIDGET_ID,
                type: "button",
                defaultArea: FirefoxCompat.CustomizableUI.AREA_NAVBAR,
                removable: true,
                label: "Extension Switchboard",
                tooltiptext: "Enable or disable Firefox extensions",
                onCommand(event) {
                    // ownerDocument.defaultView is the working path on current Firefox.
                    const win =
                        event?.target?.ownerDocument?.defaultView ??
                        event?.currentTarget?.ownerDocument?.defaultView ??
                        event?.view;

                    if (!win?.ExtensionSwitchboard) {
                        FirefoxCompat.reportError(new Error(
                            "Could not locate Extension Switchboard in the " +
                            "browser window that received the command."
                        ));
                        return;
                    }

                    win.ExtensionSwitchboard.open().catch(
                        FirefoxCompat.reportError
                    );
                }
            });
        }

        async open() {
            this.close();
            const categories = new CategoryManager(
                this.configStore,
                this.configStore.load()
            );

            const panel = new SwitchboardPanel({
                configStore: this.configStore,
                categoryManager: categories,
                extensionService: this.extensionService,
                getUndoSnapshot: () => this.lastApplySnapshot,
                setUndoSnapshot: snapshot => {
                    this.lastApplySnapshot = snapshot;
                },
                onClose: () => this.close()
            });

            this.panel = panel;
            try {
                await panel.mount();
            } catch (error) {
                panel.close();
                this.panel = null;
                throw error;
            }
        }

        close() {
            this.panel?.close();
            this.panel = null;
            document.getElementById(APP.PANEL_ID)?.remove();
        }

        destroy() {
            this.close();
            this.lastApplySnapshot = null;
            StyleManager.remove();
            delete window.ExtensionSwitchboard;
        }

        initialize() {
            StyleManager.ensure();
            this.ensureWidget();
        }
    }

    const controller = new SwitchboardController();
    controller.initialize();

    window.ExtensionSwitchboard = {
        version: APP.VERSION,
        open: () => controller.open(),
        close: () => controller.close(),
        destroy: () => controller.destroy()
    };

    console.log(`Extension Switchboard ${APP.VERSION} loaded.`);
})();