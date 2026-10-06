sap.ui.define([], function () {
    "use strict";

    /**
     * Custom header actions (manifest: content.header.actions). SAP Fiori elements calls a handler with this = ExtensionAPI
     * of the page and the binding context of the object.
     */
    return {
        /**
         * Test case: "Ergebnis besprechen" opens the service assistant, which discusses the result of the latest run with the
         * findings of the deterministic result analysis. The nonce n makes every press a new request (back navigation does
         * not open the discussion again).
         */
        discuss: async function (context) {
            const uuid = await context.requestProperty("TestCaseUUID");
            return this.routing.navigateToRoute("AgentPage", { "?query": { analyze: uuid, n: String(Date.now()) } });
        },

        /** Release: analytics page of this release */
        showReleaseAnalytics: async function (context) {
            const releaseId = await context.requestProperty("ReleaseID");
            return this.routing.navigateToRoute("Analytics", { "?query": { release: releaseId } });
        }
    };
});
