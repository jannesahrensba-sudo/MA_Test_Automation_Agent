sap.ui.define(["sap/ui/core/format/NumberFormat"], function (NumberFormat) {
    "use strict";

    const amountFormat = NumberFormat.getFloatInstance({ minFractionDigits: 2, maxFractionDigits: 2, groupingEnabled: true });
    const STATE_BY_CRITICALITY = { 1: "Negative", 2: "Critical", 3: "Positive", 5: "Neutral" };

    /**
     * Formatters of the custom section "Document Flow" (sap.suite.ui.commons.ProcessFlow).
     * The nodes are the DocumentReference rows of the latest execution; the connections come from the
     * successor documents of each row (like the document flow of the real service documents).
     */
    return {
        title: function (businessObject, documentId) {
            return businessObject ? `${businessObject} ${documentId || ""}`.trim() : documentId;
        },

        state: function (criticality) {
            return STATE_BY_CRITICALITY[criticality] || "Neutral";
        },

        texts: function (netAmount, currency) {
            return netAmount === null || netAmount === undefined || netAmount === "" ? [] : [`${amountFormat.format(Number(netAmount))} ${currency || ""}`.trim()];
        },

        /** connections: the successor documents delivered by the service (comma-separated) */
        children: function (successors) {
            return successors ? String(successors).split(",").filter(Boolean) : [];
        }
    };
});
