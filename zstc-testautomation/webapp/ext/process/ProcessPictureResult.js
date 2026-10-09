sap.ui.define(["sap/ui/core/Element"], function (Element) {
    "use strict";

    /**
     * Result of a process step in a run (aggregation "results" of zstc.testautomation.ext.process.ProcessPicture);
     * bound to the execution steps of the latest run (ProcessStepID, ExecutionStatus).
     */
    return Element.extend("zstc.testautomation.ext.process.ProcessPictureResult", {
        metadata: {
            properties: {
                stepId: { type: "string", defaultValue: "" },
                status: { type: "string", defaultValue: "" }
            }
        }
    });
});
