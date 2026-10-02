sap.ui.define([], function () {
    "use strict";

    const NAMESPACE = "com.sap.gateway.srvd.zui_stc_test_case.v0001.";

    /**
     * Rows of the read models (test cases in a release scope, regression run items, process steps and processes of a team)
     * open the object page of the business object they refer to. Used in routing.onBeforeNavigation of the object page
     * controller extensions; the table rows are navigable through the "navigation" settings of the page in manifest.json.
     */
    const TARGETS = {
        ReleaseTestCaseType: { route: "TestCaseObjectPage", key: (row) => "TestCaseUUID=" + row.TestCaseUUID + ",IsActiveEntity=true", select: "TestCaseUUID" },
        RegressionRunItemType: { route: "TestCaseObjectPage", key: (row) => "TestCaseUUID=" + row.TestCaseUUID + ",IsActiveEntity=true", select: "TestCaseUUID" },
        ProcessStepVHType: { route: "BusinessProcessObjectPage", key: (row) => "ProcessID='" + encodeURIComponent(row.ProcessID) + "',IsActiveEntity=true", select: "ProcessID" },
        BusinessProcessVHType: { route: "BusinessProcessObjectPage", key: (row) => "ProcessID='" + encodeURIComponent(row.ProcessID) + "',IsActiveEntity=true", select: "ProcessID" }
    };

    /**
     * @param {object} controller controller extension (this.base gives the page controller)
     * @param {sap.ui.model.odata.v4.Context} context binding context of the pressed row
     * @returns {Promise<boolean>} true when the navigation was handled here
     */
    async function navigate(controller, context) {
        if (!context) {
            return false;
        }
        const metaModel = context.getModel().getMetaModel();
        const typeName = String(metaModel.getObject(metaModel.getMetaPath(context.getPath()) + "/$Type") || "").replace(NAMESPACE, "");
        const target = TARGETS[typeName];
        if (!target) {
            return false;
        }
        const keyValue = await context.requestProperty(target.select);
        if (!keyValue) {
            return false;
        }
        const row = {};
        row[target.select] = keyValue;
        await controller.base.getExtensionAPI().routing.navigateToRoute(target.route, { key: target.key(row) });
        return true;
    }

    return { navigate: navigate };
});
