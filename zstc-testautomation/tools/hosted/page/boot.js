/* Bootstrap configuration of the hosted mockup (runs before sap-ui-core.js). */
(function () {
    "use strict";
    var root = document.documentElement;
    function isDark() {
        var explicit = root.getAttribute("data-theme");
        if (explicit === "dark" || explicit === "light") {
            return explicit === "dark";
        }
        return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
    window.zstcThemeName = function () {
        return isDark() ? "sap_horizon_dark" : "sap_horizon";
    };
    window["sap-ui-config"] = {
        theme: window.zstcThemeName(),
        language: "en",
        async: true,
        compatversion: "edge",
        preload: "async",
        // all libraries are loaded as preload bundles at start (lazy dependencies such as sap.ui.unified included)
        libs: [
            "sap.m", "sap.f", "sap.ui.layout", "sap.ui.unified", "sap.ui.table", "sap.uxap", "sap.ui.fl", "sap.ui.mdc",
            "sap.fe.base", "sap.fe.navigation", "sap.fe.placeholder", "sap.fe.controls", "sap.fe.core", "sap.fe.macros",
            "sap.fe.templates", "sap.suite.ui.microchart", "sap.suite.ui.commons", "sap.ui.export"
        ].join(","),
        resourceroots: { "zstc.testautomation": "./app/", "zstc.testautomation.launcher": "./launcher/" },
        oninit: "module:zstc/testautomation/launcher/Launcher"
    };
})();
