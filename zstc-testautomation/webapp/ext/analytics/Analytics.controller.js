sap.ui.define(
    ["sap/fe/core/PageController", "sap/ui/model/json/JSONModel", "sap/base/i18n/Localization", "./dashboardModel"],
    function (PageController, JSONModel, Localization, dashboardModel) {
        "use strict";

        const RELEASE_SELECT =
            "ReleaseID,IsActiveEntity,ReleaseName,ReleaseType,ReleaseStatus,SAPProductVersion,FeaturePackStack,TestStartDate,TestEndDate," +
            "TestCaseCount,ApprovedCount,ExecutedCount,PassedCount,FailedCount,PassRate,StepCoverage";

        /**
         * Analytics (FPM custom page): results of a release per process team and process step, failure patterns from the
         * deterministic result analysis and the jump-off "Mit Assistent besprechen" to the service assistant.
         * Data access only through the OData V4 model of the app (read models of the release, executions, findings).
         * Route Analytics, optional ?release=<ReleaseID>.
         */
        return PageController.extend("zstc.testautomation.ext.analytics.Analytics", {
            onInit: function () {
                PageController.prototype.onInit.apply(this, arguments);
                this.dash = new JSONModel({
                    loaded: false,
                    releases: [],
                    releaseId: "",
                    releaseInfo: "",
                    kpis: { passRate: 0, stepCoverage: 0, inScope: 0, executed: 0, failed: 0, openFindings: 0 },
                    distribution: [],
                    teams: [],
                    steps: [],
                    patterns: [],
                    failedCases: [],
                    trend: [],
                    runs: []
                });
                this.getView().setModel(this.dash, "dash");
                this.getAppComponent().getRouter().getRoute("Analytics").attachPatternMatched(this._onMatched, this);
            },

            _text: function (key, args) {
                return this.getAppComponent().getModel("i18n").getResourceBundle().getText(key, args);
            },

            _model: function () {
                return this.getView().getModel() || this.getAppComponent().getModel();
            },

            _read: async function (path, select, filter, orderby) {
                const parameters = { $$groupId: "$direct", $select: select };
                if (filter) {
                    parameters.$filter = filter;
                }
                if (orderby) {
                    parameters.$orderby = orderby;
                }
                const binding = this._model().bindList(path, undefined, undefined, undefined, parameters);
                try {
                    return (await binding.requestContexts(0, 1000)).map((context) => context.getObject());
                } finally {
                    binding.destroy();
                }
            },

            _onMatched: async function (event) {
                const query = (event.getParameter("arguments") || {})["?query"] || {};
                await this._loadReleases();
                const releases = this.dash.getProperty("/releases");
                const requested = query.release && releases.find((r) => r.ReleaseID === query.release);
                const current = releases.find((r) => r.ReleaseID === this.dash.getProperty("/releaseId"));
                const inTest = releases.find((r) => r.ReleaseStatus === "IN_TEST");
                const release = requested || current || inTest || releases[0];
                if (release) {
                    this.dash.setProperty("/releaseId", release.ReleaseID);
                    await this._loadRelease();
                }
            },

            _loadReleases: async function () {
                const releases = await this._read("/Release", RELEASE_SELECT, "IsActiveEntity eq true", "TestStartDate");
                this.dash.setProperty(
                    "/releases",
                    releases.map((r) =>
                        Object.assign({}, r, {
                            text: r.ReleaseID + " · " + r.ReleaseName + " (" + this._text("releaseStatus" + r.ReleaseStatus) + ")"
                        })
                    )
                );
            },

            /** reads the read models of the selected release and computes the page data */
            _loadRelease: async function () {
                const releaseId = this.dash.getProperty("/releaseId");
                const release = this.dash.getProperty("/releases").find((r) => r.ReleaseID === releaseId);
                if (!release) {
                    return;
                }
                const quoted = "'" + releaseId.replace(/'/g, "''") + "'";
                this.getView().setBusy(true);
                try {
                    const [scopes, cases, coverage, executions, findings, runs, teams] = await Promise.all([
                        this._read("/ReleaseScope", "ScopeUUID,IsActiveEntity,ReleaseID,ProcessTeam,ProcessID,TestCaseCount,ExecutedCount,PassedCount,FailedCount,ScopeStatus", "ReleaseID eq " + quoted + " and IsActiveEntity eq true"),
                        this._read("/ReleaseTestCase", "ReleaseTestCaseUUID,TestCaseUUID,CaseID,Title,ProcessTeam,ApprovalStatus,ResultInRelease,ExternalExecutionID,ExecutedAt", "ReleaseID eq " + quoted, "CaseID"),
                        this._read(
                            "/ReleaseStepCoverage",
                            "CoverageUUID,StepID,StepName,Sequence,ResponsibleTeam,IsHandover,CoverageStatus,TestCaseCount,ExecutedCount,PassedCount,FailedCount,Remark",
                            "ReleaseID eq " + quoted,
                            "Sequence"
                        ),
                        this._read(
                            "/Execution",
                            "ExecutionUUID,IsActiveEntity,TestCaseUUID,ExternalExecutionID,Status,FunctionalResult,StartedAt,ReleaseID,TestCaseVersion,AnalysisHeadline,RunType",
                            "ReleaseID eq " + quoted + " and IsActiveEntity eq true"
                        ),
                        this._read(
                            "/ResultFinding",
                            "FindingUUID,IsActiveEntity,TestCaseUUID,CaseID,ExternalExecutionID,ReleaseID,Sequence,FindingCode,Category,Severity,ProcessStepID,StepName,ResponsibleTeam,Confidence,Parameters,Finding,ProbableCause,Recommendation,Evidence",
                            "ReleaseID eq " + quoted + " and IsActiveEntity eq true"
                        ),
                        this._read("/RegressionRun", "RunUUID,RunID,Status,StartedAt,PassedCount,FailedCount,SkippedCount,PassRate", "ReleaseID eq " + quoted),
                        this._read("/ProcessTeamVH", "ProcessTeam,ProcessTeamName")
                    ]);
                    const names = new Map(teams.map((t) => [t.ProcessTeam, t.ProcessTeamName]));
                    const data = dashboardModel.build({
                        release: release,
                        scopes: scopes,
                        cases: cases,
                        coverage: coverage,
                        executions: executions,
                        findings: findings,
                        runs: runs,
                        text: this._text.bind(this),
                        teamName: (team) => names.get(team) || team || "",
                        german: Localization.getLanguage().toLowerCase().startsWith("de")
                    });
                    Object.keys(data).forEach((key) => this.dash.setProperty("/" + key, data[key]));
                    this.dash.setProperty("/loaded", true);
                    this.dash.setProperty(
                        "/releaseInfo",
                        this._text("analyticsReleaseInfo", [
                            release.SAPProductVersion || "",
                            release.FeaturePackStack || "",
                            this._text("releaseStatus" + release.ReleaseStatus),
                            release.TestStartDate || "–",
                            release.TestEndDate || "–"
                        ])
                    );
                } finally {
                    this.getView().setBusy(false);
                }
            },

            onReleaseChange: function () {
                return this._loadRelease();
            },

            onRefresh: async function () {
                await this._loadReleases();
                return this._loadRelease();
            },

            onOpenRelease: function () {
                const releaseId = this.dash.getProperty("/releaseId");
                if (releaseId) {
                    return this.routing.navigateToRoute("ReleaseObjectPage", { key: "ReleaseID='" + encodeURIComponent(releaseId) + "',IsActiveEntity=true" });
                }
            },

            _scrollTo: function (id) {
                const control = this.byId(id);
                const domRef = control && control.getDomRef();
                if (domRef) {
                    domRef.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            },

            onScrollToSteps: function () {
                this._scrollTo("stepPanel");
            },

            onScrollToFailures: function () {
                this._scrollTo("patternPanel");
            },

            /** jump-off to the service assistant: discussion of exactly the run shown for this release */
            _discuss: function (event) {
                const row = event.getSource().getBindingContext("dash").getObject();
                if (row.testCaseUUID) {
                    return this.routing.navigateToRoute("AgentPage", { "?query": { analyze: row.testCaseUUID, run: row.run, n: String(Date.now()) } });
                }
            },

            onDiscussPattern: function (event) {
                return this._discuss(event);
            },

            onDiscussCase: function (event) {
                return this._discuss(event);
            },

            onOpenCase: function (event) {
                const uuid = event.getSource().getBindingContext("dash").getProperty("testCaseUUID");
                return this.routing.navigateToRoute("TestCaseObjectPage", { key: "TestCaseUUID=" + uuid + ",IsActiveEntity=true" });
            },

            onShowAssistant: function () {
                return this.routing.navigateToRoute("AgentPage");
            },

            onShowOverview: function () {
                return this.routing.navigateToRoute("Overview");
            }
        });
    }
);
