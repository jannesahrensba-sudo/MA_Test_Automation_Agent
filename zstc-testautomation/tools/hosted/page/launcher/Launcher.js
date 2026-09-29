sap.ui.define(
    ["sap/ui/core/ComponentContainer", "sap/f/ShellBar", "sap/m/OverflowToolbarButton", "sap/ui/core/Theming", "sap/ui/core/routing/HashChanger"],
    function (ComponentContainer, ShellBar, OverflowToolbarButton, Theming, HashChanger) {
        "use strict";

        /**
         * Hosted mockup launcher: a slim shell (sap.f.ShellBar) and the SAP Fiori elements app component.
         * Replaces the SAP Fiori launchpad sandbox of the local setup (npm start); the app itself is unchanged.
         */
        const shell = new ShellBar("zstcShellBar", {
            title: "Service-to-Cash Test Automation Assistant",
            secondTitle: "Mockup · mock data, no SAP system",
            showNavButton: true,
            navButtonPressed: function () {
                window.history.back();
            },
            additionalContent: [
                new OverflowToolbarButton("zstcHome", {
                    icon: "sap-icon://home",
                    text: "Overview",
                    tooltip: "Overview",
                    press: function () {
                        HashChanger.getInstance().setHash("");
                    }
                })
            ]
        });
        shell.placeAt("zstc-shell");

        const container = new ComponentContainer("zstcApp", {
            name: "zstc.testautomation",
            manifest: true,
            async: true,
            height: "100%",
            width: "100%",
            settings: { id: "zstc" },
            componentCreated: function () {
                const loading = document.getElementById("zstc-loading");
                if (loading) {
                    loading.remove();
                }
            },
            componentFailed: function (event) {
                const loading = document.getElementById("zstc-loading");
                if (loading) {
                    loading.querySelector("span").textContent = "The app could not be started: " + event.getParameter("reason");
                }
            }
        });
        container.placeAt("zstc-app");

        // follow the viewer's light/dark setting
        function syncTheme() {
            const theme = window.zstcThemeName();
            if (Theming.getTheme() !== theme) {
                Theming.setTheme(theme);
            }
        }
        if (window.matchMedia) {
            window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
        }
        new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }
);
