sap.ui.define(["sap/ui/core/Element"], function (Element) {
    "use strict";

    /**
     * One process step of a process picture (aggregation "steps" of zstc.testautomation.ext.process.ProcessPicture);
     * bound to ProcessStep / ProcessStepVH or set from the service assistant.
     */
    return Element.extend("zstc.testautomation.ext.process.ProcessPictureStep", {
        metadata: {
            properties: {
                stepId: { type: "string", defaultValue: "" },
                name: { type: "string", defaultValue: "" },
                sequence: { type: "int", defaultValue: 0 },
                businessObject: { type: "string", defaultValue: "" },
                team: { type: "string", defaultValue: "" },
                teamName: { type: "string", defaultValue: "" },
                assignment: { type: "string", defaultValue: "" },
                variants: { type: "string", defaultValue: "" },
                pilot: { type: "string", defaultValue: "PILOT" },
                automation: { type: "string", defaultValue: "" }
            }
        }
    });
});
