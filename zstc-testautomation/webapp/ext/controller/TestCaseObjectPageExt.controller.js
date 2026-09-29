sap.ui.define(["sap/ui/core/mvc/ControllerExtension", "sap/base/Log"], function (ControllerExtension, Log) {
    "use strict";

    const NAMESPACE = "com.sap.gateway.srvd.zui_stc_test_case.v0001";
    const POLLING_INTERVAL_MS = 2000;

    /**
     * Controller extension of the test case object page.
     *
     * Status polling: while the latest execution is RUNNING (the action refreshExecution is available), the bound action
     * is invoked every 2 seconds through the public EditFlow API (no manual AJAX). The side effects annotated for the
     * action refresh the header, the steps, the documents and the assertions.
     */
    return ControllerExtension.extend("zstc.testautomation.ext.controller.TestCaseObjectPageExt", {
        override: {
            onInit: function () {
                this._pollingTimer = setInterval(this._poll.bind(this), POLLING_INTERVAL_MS);
            },

            onExit: function () {
                clearInterval(this._pollingTimer);
            }
        },

        _isVisible: function () {
            const domRef = this.base.getView().getDomRef();
            return !!domRef && domRef.offsetParent !== null && document.visibilityState !== "hidden";
        },

        _poll: async function () {
            const context = this.base.getView().getBindingContext();
            if (this._refreshing || !context || !this._isVisible()) {
                return;
            }
            this._refreshing = true;
            try {
                // instance feature control: refreshExecution is available exactly while an execution is running
                const [isActiveEntity, running] = await context.requestProperty(["IsActiveEntity", "__OperationControl/refreshExecution"]);
                if (isActiveEntity !== true || running !== true) {
                    return;
                }
                await this.base.editFlow.invokeAction(`${NAMESPACE}.refreshExecution`, {
                    contexts: context,
                    model: context.getModel()
                });
            } catch (error) {
                // the error message is shown by SAP Fiori elements; polling stops once the status is no longer RUNNING
                Log.warning("Status refresh of the running execution failed", error, "zstc.testautomation");
            } finally {
                this._refreshing = false;
            }
        }
    });
});
