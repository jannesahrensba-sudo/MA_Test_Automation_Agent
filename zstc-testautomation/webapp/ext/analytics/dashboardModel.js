sap.ui.define(["../agent/core/resultReport"], function (resultReport) {
    "use strict";

    /**
     * Analytics of a release (pure computation, no UI5): key figures, results per process team, result distribution,
     * coverage along the process path, failure patterns from the deterministic result analysis and the pass rate over
     * time. Input are the read models of the OData service (Release, ReleaseScope, ReleaseTestCase, ReleaseStepCoverage,
     * Execution, ResultFinding); the page reads them through the OData V4 model of the app.
     */

    const PASSED = ["PASSED", "PASSED_WITH_WARNING"];
    const FAILED = ["FAILED_FUNCTIONAL", "FAILED_TECHNICAL", "BLOCKED"];
    const RESULT_STATE = { PASSED: "Success", PASSED_WITH_WARNING: "Warning", FAILED_FUNCTIONAL: "Error", FAILED_TECHNICAL: "Error", BLOCKED: "Error" };
    const COVERAGE_STATE = {
        PASSED: "Success",
        FAILED: "Error",
        IN_PROGRESS: "Information",
        NOT_EXECUTED: "Warning",
        NOT_COVERED: "Error",
        MANUAL: "None",
        OPEN: "Warning",
        LATER: "None"
    };
    const SEVERITY_STATE = { ERROR: "Error", WARNING: "Warning", INFO: "Information", SUCCESS: "Success" };
    const CONFIDENCE_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const MAX_TREND_POINTS = 6;

    function rate(part, total) {
        return total ? Math.round((part / total) * 100) : 0;
    }

    function rateColor(value) {
        return value >= 100 ? "Good" : value >= 80 ? "Critical" : "Error";
    }

    function day(iso) {
        return String(iso || "").slice(0, 10);
    }

    /** "2026-10-01" → "01.10." */
    function dayLabel(isoDay) {
        const parts = isoDay.split("-");
        return parts.length === 3 ? parts[2] + "." + parts[1] + "." : isoDay;
    }

    /**
     * @param {object} input input
     * @param {object} input.release Release row
     * @param {object[]} input.scopes ReleaseScope rows of the release
     * @param {object[]} input.cases ReleaseTestCase rows of the release
     * @param {object[]} input.coverage ReleaseStepCoverage rows of the release
     * @param {object[]} input.executions Execution rows of the release
     * @param {object[]} input.findings ResultFinding rows of the release
     * @param {object[]} [input.runs] RegressionRun rows of the release
     * @param {Function} input.text (key, args) → text (i18n)
     * @param {Function} [input.teamName] team → name
     * @param {boolean} [input.german] German finding texts (resultReport) instead of the texts of the backend
     * @returns {object} data of the analytics page
     */
    function build(input) {
        const text = input.text;
        const teamName = input.teamName || ((team) => team);
        const release = input.release || {};
        const cases = input.cases || [];
        const executions = input.executions || [];
        const executed = cases.filter((c) => c.ResultInRelease);
        const passed = cases.filter((c) => PASSED.indexOf(c.ResultInRelease) > -1);
        const failed = cases.filter((c) => FAILED.indexOf(c.ResultInRelease) > -1);
        // result of the release = latest run of each test case in this release
        const latestRuns = new Set(executed.map((c) => c.ExternalExecutionID).filter(Boolean));
        const executionById = new Map(executions.map((e) => [e.ExternalExecutionID, e]));
        const currentFindings = (input.findings || []).filter((f) => latestRuns.has(f.ExternalExecutionID));
        const open = currentFindings.filter((f) => f.Severity === "ERROR" || f.Severity === "WARNING");

        // German texts of a finding through the same module as the service assistant
        const localized = function (finding) {
            if (!input.german) {
                return { title: finding.Finding, cause: finding.ProbableCause, recommendation: finding.Recommendation };
            }
            const execution = executionById.get(finding.ExternalExecutionID) || {};
            const analysis = resultReport.fromRead({ testCase: { CaseID: finding.CaseID }, execution: execution, findings: [finding] });
            const german = resultReport.germanFindings(analysis)[0];
            return { title: german.titel, cause: german.ursache, recommendation: german.empfehlung };
        };

        const kpis = {
            inScope: cases.length,
            approved: Number(release.ApprovedCount) || 0,
            executed: executed.length,
            passed: passed.length,
            failed: failed.length,
            notExecuted: cases.length - executed.length,
            passRate: Number(release.PassRate) || rate(passed.length, executed.length),
            passRateColor: rateColor(Number(release.PassRate) || rate(passed.length, executed.length)),
            stepCoverage: Number(release.StepCoverage) || 0,
            stepCoverageColor: rateColor(Number(release.StepCoverage) || 0),
            openFindings: open.length
        };

        const distribution = [
            { label: text("analyticsPassed"), value: passed.length, color: "Good" },
            { label: text("analyticsFailed"), value: failed.length, color: "Error" },
            { label: text("analyticsNotExecuted"), value: cases.length - executed.length, color: "Neutral" }
        ].map((segment) => Object.assign(segment, { displayedValue: String(segment.value) }));

        // results per process team: test cases of the team in the scope (ReleaseScope rows without test cases stay visible)
        const teamKeys = [];
        (input.scopes || []).forEach((scope) => {
            if (teamKeys.indexOf(scope.ProcessTeam) === -1) {
                teamKeys.push(scope.ProcessTeam);
            }
        });
        cases.forEach((c) => {
            if (teamKeys.indexOf(c.ProcessTeam) === -1) {
                teamKeys.push(c.ProcessTeam);
            }
        });
        const teams = teamKeys.map((team) => {
            const own = cases.filter((c) => c.ProcessTeam === team);
            const ownPassed = own.filter((c) => PASSED.indexOf(c.ResultInRelease) > -1).length;
            const ownFailed = own.filter((c) => FAILED.indexOf(c.ResultInRelease) > -1).length;
            const ownNotExecuted = own.length - ownPassed - ownFailed;
            const scopes = (input.scopes || []).filter((s) => s.ProcessTeam === team);
            let state = "None";
            let status;
            if (!own.length) {
                status = text("analyticsTeamNoCases", [scopes.map((s) => s.ProcessID).join(", ")]);
                state = "Warning";
            } else if (ownFailed) {
                status = text("analyticsTeamFailed", [ownFailed]);
                state = "Error";
            } else if (ownNotExecuted) {
                status = text("analyticsTeamOpen", [ownNotExecuted]);
                state = ownPassed ? "Information" : "Warning";
            } else {
                status = text("analyticsTeamPassed");
                state = "Success";
            }
            return {
                team: team,
                name: teamName(team),
                total: own.length,
                passed: ownPassed,
                failed: ownFailed,
                notExecuted: ownNotExecuted,
                summary: text("analyticsTeamSummary", [ownPassed, own.length]),
                status: status,
                state: state,
                bars: own.length
                    ? [
                          { value: ownPassed, color: "Good", displayValue: String(ownPassed) },
                          { value: ownFailed, color: "Error", displayValue: String(ownFailed) },
                          { value: ownNotExecuted, color: "Neutral", displayValue: String(ownNotExecuted) }
                      ]
                    : []
            };
        });

        const steps = (input.coverage || [])
            .slice()
            .sort((a, b) => a.Sequence - b.Sequence)
            .map((row) => ({
                sequence: row.Sequence,
                stepId: row.StepID,
                stepName: row.StepName,
                team: row.ResponsibleTeam,
                teamName: teamName(row.ResponsibleTeam),
                handover: !!row.IsHandover,
                status: row.CoverageStatus,
                statusText: text("coverage" + row.CoverageStatus) || row.CoverageStatus,
                state: COVERAGE_STATE[row.CoverageStatus] || "None",
                counts: text("analyticsStepCounts", [row.PassedCount || 0, row.FailedCount || 0, row.TestCaseCount || 0]),
                remark: row.Remark || ""
            }));

        // failure patterns: the same finding (code, process step, team) in several test cases is one pattern
        const groups = new Map();
        open.forEach((finding) => {
            const key = [finding.FindingCode, finding.ProcessStepID, finding.ResponsibleTeam].join("|");
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(finding);
        });
        const patterns = Array.from(groups.values())
            .map((findings) => {
                const first = findings[0];
                const texts = localized(first);
                const caseIds = findings.map((f) => f.CaseID);
                const confidence = findings.reduce((best, f) => (CONFIDENCE_RANK[f.Confidence] > CONFIDENCE_RANK[best] ? f.Confidence : best), first.Confidence);
                return {
                    code: first.FindingCode,
                    title: text("finding" + first.FindingCode) || first.FindingCode,
                    severity: first.Severity,
                    state: SEVERITY_STATE[first.Severity] || "None",
                    count: findings.length,
                    cases: caseIds.join(", "),
                    step: first.ProcessStepID ? first.ProcessStepID + (first.StepName ? " " + first.StepName : "") : "",
                    team: first.ResponsibleTeam ? teamName(first.ResponsibleTeam) : text("analyticsNoTeam"),
                    example: texts.title,
                    cause: texts.cause,
                    recommendation: texts.recommendation,
                    confidence: text("confidence" + confidence) || confidence,
                    testCaseUUID: first.TestCaseUUID
                };
            })
            .sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "ERROR" ? -1 : 1));

        const failedCases = failed.map((c) => {
            const execution = executionById.get(c.ExternalExecutionID) || {};
            const main = currentFindings
                .filter((f) => f.ExternalExecutionID === c.ExternalExecutionID)
                .sort((a, b) => a.Sequence - b.Sequence)
                .find((f) => f.Severity === "ERROR" || f.Severity === "WARNING");
            const texts = main ? localized(main) : undefined;
            return {
                caseId: c.CaseID,
                title: c.Title,
                team: teamName(c.ProcessTeam),
                result: c.ResultInRelease,
                resultText: text("result" + c.ResultInRelease) || c.ResultInRelease,
                state: RESULT_STATE[c.ResultInRelease] || "None",
                run: c.ExternalExecutionID,
                headline: texts ? (texts.cause || texts.title) : execution.AnalysisHeadline || "",
                testCaseUUID: c.TestCaseUUID
            };
        });

        // pass rate over time: latest result per test case at the end of each day with runs in this release
        const finished = executions.filter((e) => e.FunctionalResult && e.Status !== "RUNNING").sort((a, b) => String(a.StartedAt).localeCompare(String(b.StartedAt)));
        const days = [];
        finished.forEach((e) => {
            if (days.indexOf(day(e.StartedAt)) === -1) {
                days.push(day(e.StartedAt));
            }
        });
        const trend = days.slice(-MAX_TREND_POINTS).map((d) => {
            const runsOfDay = finished.filter((e) => day(e.StartedAt) === d).length;
            const latest = new Map();
            finished.filter((e) => day(e.StartedAt) <= d).forEach((e) => latest.set(e.TestCaseUUID, e.FunctionalResult));
            const results = Array.from(latest.values());
            const value = rate(results.filter((r) => PASSED.indexOf(r) > -1).length, results.length);
            return {
                label: dayLabel(d),
                secondaryLabel: runsOfDay === 1 ? text("analyticsTrendRun") : text("analyticsTrendRuns", [runsOfDay]),
                value: value,
                displayedValue: value + " %",
                color: rateColor(value)
            };
        });

        const runs = (input.runs || [])
            .slice()
            .sort((a, b) => String(b.StartedAt).localeCompare(String(a.StartedAt)))
            .map((run) => ({
                runId: run.RunID,
                startedAt: run.StartedAt,
                status: run.Status,
                text: text("analyticsRunText", [run.PassedCount || 0, run.FailedCount || 0, run.SkippedCount || 0, run.PassRate || 0]),
                state: run.PassRate >= 100 ? "Success" : run.FailedCount ? "Error" : "Warning"
            }));

        return {
            kpis: kpis,
            distribution: distribution,
            teams: teams,
            steps: steps,
            patterns: patterns,
            failedCases: failedCases,
            trend: trend,
            runs: runs,
            hasResults: executed.length > 0
        };
    }

    return { build: build, rate: rate };
});
