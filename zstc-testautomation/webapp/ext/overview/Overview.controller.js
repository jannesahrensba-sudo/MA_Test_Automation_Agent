sap.ui.define(["sap/fe/core/PageController", "sap/ui/model/json/JSONModel"], function (PageController, JSONModel) {
    "use strict";

    const RESULT_TILES = [
        { key: "PASSED", i18n: "kpiPassed", color: "Good", icon: "sap-icon://message-success" },
        { key: "PASSED_WITH_WARNING", i18n: "kpiWarning", color: "Critical", icon: "sap-icon://message-warning" },
        { key: "FAILED", i18n: "kpiFailed", color: "Error", icon: "sap-icon://message-error" },
        { key: "BLOCKED", i18n: "kpiBlocked", color: "Error", icon: "sap-icon://stop" }
    ];

    /**
     * Overview (FPM custom page): entry points and key figures of the test cases.
     * Data access only through the OData V4 model of the app — no manual AJAX.
     */
    return PageController.extend("zstc.testautomation.ext.overview.Overview", {
        onInit: function () {
            PageController.prototype.onInit.apply(this, arguments);
            this.getView().setModel(new JSONModel({ tiles: [] }), "kpi");
            this.getAppComponent()
                .getRouter()
                .getRoute("Overview")
                .attachPatternMatched(this._onOverviewMatched, this);
        },

        _onOverviewMatched: function () {
            this._refreshKpis();
            const table = this.byId("testCaseTable");
            if (table && table.refresh) {
                table.refresh();
            }
        },

        _refreshKpis: async function () {
            const bundle = this.getAppComponent().getModel("i18n").getResourceBundle();
            const binding = this.getView()
                .getModel()
                .bindList("/TestCase", undefined, undefined, undefined, {
                    $select: "TestCaseUUID,IsActiveEntity,ValidationStatus,ApprovalStatus,ExecutionStatus,FinalResult,AssignmentStatus",
                    $filter: "IsActiveEntity eq true"
                });
            const releaseBinding = this.getView()
                .getModel()
                .bindList("/Release", undefined, undefined, undefined, {
                    $select: "ReleaseID,IsActiveEntity,ReleaseName,ReleaseStatus,PassRate,StepCoverage",
                    $filter: "IsActiveEntity eq true and ReleaseStatus eq 'IN_TEST'"
                });
            let rows = [];
            let releases = [];
            try {
                [rows, releases] = await Promise.all([
                    binding.requestContexts(0, 1000).then((contexts) => contexts.map((context) => context.getObject())),
                    releaseBinding.requestContexts(0, 10).then((contexts) => contexts.map((context) => context.getObject()))
                ]);
            } finally {
                binding.destroy();
                releaseBinding.destroy();
            }
            const count = (predicate) => rows.filter(predicate).length;
            const tiles = [
                {
                    header: bundle.getText("kpiTotal"),
                    subheader: "",
                    footer: bundle.getText("kpiFooterLifecycle"),
                    value: String(rows.length),
                    color: "Neutral",
                    icon: "sap-icon://checklist"
                },
                {
                    header: bundle.getText("kpiRunning"),
                    subheader: "",
                    footer: bundle.getText("kpiFooterLifecycle"),
                    value: String(count((r) => r.ExecutionStatus === "RUNNING")),
                    color: "Neutral",
                    icon: "sap-icon://process"
                },
                {
                    header: bundle.getText("kpiOpen"),
                    subheader: "",
                    footer: bundle.getText("kpiFooterLifecycle"),
                    value: String(count((r) => r.ValidationStatus === "VALID" && r.ApprovalStatus !== "APPROVED")),
                    color: "Neutral",
                    icon: "sap-icon://approvals"
                },
                {
                    header: bundle.getText("kpiInvalid"),
                    subheader: "",
                    footer: bundle.getText("kpiFooterLifecycle"),
                    value: String(count((r) => r.ValidationStatus === "INVALID" || r.ValidationStatus === "AMBIGUOUS")),
                    color: "Critical",
                    icon: "sap-icon://validate"
                },
                {
                    header: bundle.getText("kpiAssignmentOpen"),
                    subheader: "",
                    footer: bundle.getText("kpiFooterLifecycle"),
                    value: String(count((r) => r.AssignmentStatus === "OPEN")),
                    color: "Critical",
                    icon: "sap-icon://chain-link"
                }
            ]
                .concat(
                    releases.map((release) => ({
                        header: bundle.getText("kpiReleasePassRate"),
                        subheader: release.ReleaseName,
                        footer: bundle.getText("kpiFooterRelease", [release.StepCoverage]),
                        value: String(release.PassRate),
                        color: release.PassRate >= 100 ? "Good" : release.PassRate >= 80 ? "Critical" : "Error",
                        icon: "sap-icon://calendar",
                        release: release.ReleaseID
                    }))
                )
                .concat(
                RESULT_TILES.map((tile) => ({
                    header: bundle.getText(tile.i18n),
                    subheader: "",
                    footer: bundle.getText("kpiFooterResult"),
                    value: String(count((r) => (tile.key === "FAILED" ? String(r.FinalResult).startsWith("FAILED") : r.FinalResult === tile.key))),
                    color: tile.color,
                    icon: tile.icon
                }))
            );
            this.getView().getModel("kpi").setProperty("/tiles", tiles);
        },

        onCreateTestCase: function () {
            return this.editFlow.createDocument("/TestCase", { creationMode: "NewPage" });
        },

        onShowTestCases: function () {
            return this.routing.navigateToRoute("TestCaseList");
        },

        /** KPI tiles: the release tile opens the release, all other tiles the test case list */
        onTilePress: function (event) {
            const release = event.getSource().getBindingContext("kpi").getProperty("release");
            if (release) {
                return this.routing.navigateToRoute("ReleaseObjectPage", { key: "ReleaseID='" + encodeURIComponent(release) + "',IsActiveEntity=true" });
            }
            return this.onShowTestCases();
        },

        onShowConfiguration: function () {
            return this.routing.navigateToRoute("ProcessProfileList");
        },

        onShowReleases: function () {
            return this.routing.navigateToRoute("ReleaseList");
        },

        onShowAnalytics: function () {
            return this.routing.navigateToRoute("Analytics");
        },

        onShowProcesses: function () {
            return this.routing.navigateToRoute("BusinessProcessList");
        },

        onShowProcessTeams: function () {
            return this.routing.navigateToRoute("ProcessTeamList");
        },

        onShowAssistant: function () {
            return this.routing.navigateToRoute("AgentPage");
        }
    });
});
