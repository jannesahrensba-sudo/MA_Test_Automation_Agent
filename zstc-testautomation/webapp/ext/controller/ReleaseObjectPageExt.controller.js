sap.ui.define(["sap/ui/core/mvc/ControllerExtension", "sap/base/Log", "./traceNavigation"], function (ControllerExtension, Log, traceNavigation) {
    "use strict";

    const NAMESPACE = "com.sap.gateway.srvd.zui_stc_test_case.v0001";
    const POLLING_INTERVAL_MS = 2000;

    /**
     * Controller extension of the release object page.
     *
     * - Status polling of a running regression run: while refreshRegressionRun is available (__OperationControl), the bound
     *   action is invoked every 2 seconds through the public EditFlow API; its side effects refresh KPIs, scope, coverage
     *   and the run tables.
     * - Rows of "Test Cases in Scope" and of the regression run open the test case (routing.onBeforeNavigation).
     */
    return ControllerExtension.extend("zstc.testautomation.ext.controller.ReleaseObjectPageExt", {
        override: {
            onInit: function () {
                this._pollingTimer = setInterval(this._poll.bind(this), POLLING_INTERVAL_MS);
            },

            onExit: function () {
                clearInterval(this._pollingTimer);
            },

            routing: {
                onBeforeNavigation: function (parameters) {
                    return traceNavigation.navigate(this, parameters && parameters.bindingContext);
                }
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
                const [isActiveEntity, running] = await context.requestProperty(["IsActiveEntity", "__OperationControl/refreshRegressionRun"]);
                if (isActiveEntity !== true || running !== true) {
                    return;
                }
                await this.base.editFlow.invokeAction(NAMESPACE + ".refreshRegressionRun", {
                    contexts: context,
                    model: context.getModel()
                });
            } catch (error) {
                Log.warning("Status refresh of the regression run failed", error, "zstc.testautomation");
            } finally {
                this._refreshing = false;
            }
        }
    });
});
