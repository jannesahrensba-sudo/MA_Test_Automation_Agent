sap.ui.define(["sap/ui/core/mvc/ControllerExtension", "./traceNavigation"], function (ControllerExtension, traceNavigation) {
    "use strict";

    /**
     * Controller extension of the process team object page: the responsible process steps and the owned processes open
     * the business process (routing.onBeforeNavigation).
     */
    return ControllerExtension.extend("zstc.testautomation.ext.controller.ProcessTeamObjectPageExt", {
        override: {
            routing: {
                onBeforeNavigation: function (parameters) {
                    return traceNavigation.navigate(this, parameters && parameters.bindingContext);
                }
            }
        }
    });
});
