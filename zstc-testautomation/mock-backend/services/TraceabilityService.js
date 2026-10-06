'use strict';
/**
 * TraceabilityService — read models of the traceability chain
 *   process team → business process → process step → test case → test run → result
 * per release:
 *   ReleaseTestCase      test cases of the release scope with their result in this release
 *   ReleaseStepCoverage  coverage of every process step (design: test cases on the path; execution: results in the release)
 *   ReleaseScope KPIs    per team and process (the link table release × team × process)
 *   Release KPIs         totals, pass rate, step coverage, latest regression run
 * and the counters on process teams, processes, process steps and variants.
 *
 * The read models are recomputed after every change that affects them (execution finished, approval, activation of
 * a test case, process, team or release) — on the real system these are CDS views over the same tables.
 */
const catalog = require('../process/processCatalog');
const { assignmentOf } = require('../process/assignment');
const { APPROVAL, EXECUTION, RESULT, COVERAGE, ASSIGNMENT, TEAM_ROLE, STEP_STATUS, ASSERTION, criticalityOf, criticalityOfPercent } = require('../common/codes');
const { stableUUID } = require('../common/uuid');

const PASSED_RESULTS = new Set([RESULT.PASSED, RESULT.PASSED_WITH_WARNING]);
const FAILED_RESULTS = new Set([RESULT.FAILED_FUNCTIONAL, RESULT.FAILED_TECHNICAL, RESULT.BLOCKED]);
const percent = (part, total) => (total ? Math.round((part / total) * 100) : 0);

async function replaceRows(repo, set, keyName, filter, rows) {
    for (const row of await repo.find(set, filter)) {
        await repo.remove(set, { [keyName]: row[keyName] });
    }
    for (const row of rows) {
        await repo.add(set, row);
    }
}

/** Everything the read models are computed from (active instances) */
async function loadState(repo) {
    const [testCases, testSteps, executions, executionSteps, assertions, documents, processes, steps, variants, releases, scopes, members, teams, runs] = await Promise.all([
        repo.find('TestCase', { IsActiveEntity: true }),
        repo.find('TestCaseStep', { IsActiveEntity: true }),
        repo.find('Execution', { IsActiveEntity: true }),
        repo.find('ExecutionStep', { IsActiveEntity: true }),
        repo.find('TestAssertion', { IsActiveEntity: true }),
        repo.find('DocumentReference', { IsActiveEntity: true }),
        repo.find('BusinessProcess', { IsActiveEntity: true }),
        repo.find('ProcessStep', { IsActiveEntity: true }),
        repo.find('ProcessVariant', { IsActiveEntity: true }),
        repo.find('Release', { IsActiveEntity: true }),
        repo.find('ReleaseScope', { IsActiveEntity: true }),
        repo.find('TeamMember', { IsActiveEntity: true }),
        repo.find('ProcessTeam', { IsActiveEntity: true }),
        repo.find('RegressionRun')
    ]);
    const group = (rows, key) => {
        const map = new Map();
        for (const row of rows) {
            if (!map.has(row[key])) {
                map.set(row[key], []);
            }
            map.get(row[key]).push(row);
        }
        return map;
    };
    return {
        testCases,
        testStepsByCase: group(testSteps, 'TestCaseUUID'),
        executions,
        executionStepsByRun: group(executionSteps, 'ExecutionUUID'),
        assertionsByRun: group(assertions, 'ExecutionUUID'),
        documentsByRun: group(documents, 'ExecutionUUID'),
        processes,
        stepsByProcess: group(steps, 'ProcessID'),
        variantsByProcess: group(variants, 'ProcessID'),
        releases,
        scopesByRelease: group(scopes, 'ReleaseID'),
        members,
        teams,
        runs
    };
}

/** Latest execution of a test case in a release (by start time) */
function latestRun(state, testCaseUUID, releaseId) {
    return state.executions
        .filter((e) => e.TestCaseUUID === testCaseUUID && e.ReleaseID === releaseId)
        .sort((a, b) => String(b.StartedAt).localeCompare(String(a.StartedAt)))[0];
}

/** Result of one process step in one run: PASSED, FAILED or undefined (not part of the run / not finished) */
function stepResult(state, run, step, testCase) {
    if (!run || run.Status === EXECUTION.RUNNING) {
        return undefined;
    }
    const executionStep = (state.executionStepsByRun.get(run.ExecutionUUID) || []).find((st) => st.ProcessStepID === step.StepID);
    if (executionStep) {
        if (executionStep.ExecutionStatus === STEP_STATUS.FAILED) {
            return 'FAILED';
        }
        if (executionStep.ExecutionStatus !== STEP_STATUS.DONE) {
            return undefined;
        }
        const failedAssertion = (state.assertionsByRun.get(run.ExecutionUUID) || []).some((a) => a.ProcessStepID === step.StepID && a.Result === ASSERTION.FAILED);
        return failedAssertion ? 'FAILED' : 'PASSED';
    }
    // decisions and manual steps have no execution step: they are covered when the run reached a later step of its path
    // (a failure further on, e.g. a net value deviation in billing, is not a failure of the decision)
    const onPath = (state.testStepsByCase.get(testCase.TestCaseUUID) || []).some((ts) => ts.ProcessStepID === step.StepID);
    if (!onPath || step.Automation === catalog.AUTOMATION.AUTOMATED) {
        return undefined;
    }
    const sequenceOf = new Map((state.stepsByProcess.get(step.ProcessID) || []).map((ps) => [ps.StepID, ps.Sequence]));
    const reached = (state.executionStepsByRun.get(run.ExecutionUUID) || []).some(
        (st) => (st.ExecutionStatus === STEP_STATUS.DONE || st.ExecutionStatus === STEP_STATUS.FAILED) && Number(sequenceOf.get(st.ProcessStepID)) > Number(step.Sequence)
    );
    return reached ? 'PASSED' : undefined;
}

/**
 * Recomputes the read models of one release.
 *
 * @param {object} repo repository
 * @param {object} state loaded state
 * @param {object} release Release entry (active)
 */
async function refreshRelease(repo, state, release) {
    const releaseId = release.ReleaseID;
    const scopes = state.scopesByRelease.get(releaseId) || [];
    const inScope = (tc) => scopes.find((sc) => sc.ProcessTeam === tc.ProcessTeam && sc.ProcessID === tc.BusinessProcess);
    const testCases = state.testCases.filter((tc) => !!inScope(tc)).sort((a, b) => String(a.CaseID).localeCompare(String(b.CaseID)));

    // test cases of the scope with their result in this release
    const caseRows = testCases.map((tc) => {
        const scope = inScope(tc);
        const run = latestRun(state, tc.TestCaseUUID, releaseId);
        const variant = (state.variantsByProcess.get(tc.BusinessProcess) || []).find((v) => v.Variant === tc.ProcessVariant);
        const remarks = [];
        if (tc.ApprovalStatus === APPROVAL.APPROVED && Number(tc.ApprovedVersion) !== Number(tc.Version)) {
            remarks.push(`version ${tc.Version} not approved`);
        } else if (tc.ApprovalStatus !== APPROVAL.APPROVED) {
            remarks.push(tc.ApprovalStatus === APPROVAL.REVOKED ? `version ${tc.Version} needs a new approval` : 'not approved');
        }
        if (run && Number(run.TestCaseVersion) !== Number(tc.Version)) {
            remarks.push(`last run with version ${run.TestCaseVersion}`);
        }
        if (scope.ProcessVersion && Number(tc.ProcessVersion) && Number(tc.ProcessVersion) !== Number(scope.ProcessVersion)) {
            remarks.push(`designed for process version ${tc.ProcessVersion}, scope expects ${scope.ProcessVersion}`);
        }
        if (tc.AssignmentStatus === ASSIGNMENT.OPEN) {
            remarks.push('process assignment open');
        }
        if (run && run.Status === EXECUTION.RUNNING) {
            remarks.push('run in progress');
        }
        const result = run && run.Status !== EXECUTION.RUNNING ? run.FunctionalResult || '' : '';
        return {
            ReleaseTestCaseUUID: stableUUID(`ReleaseTestCase|${releaseId}|${tc.TestCaseUUID}`),
            ReleaseID: releaseId,
            TestCaseUUID: tc.TestCaseUUID,
            CaseID: tc.CaseID,
            Title: tc.Title,
            ProcessTeam: tc.ProcessTeam,
            ProcessID: tc.BusinessProcess,
            ProcessVariant: tc.ProcessVariant,
            VariantName: variant?.VariantName || '',
            TestLevel: tc.TestLevel || '',
            EndObject: tc.EndObject || '',
            TestCaseVersion: Number(tc.Version) || 0,
            ApprovedVersion: Number(tc.ApprovedVersion) || 0,
            ApprovalStatus: tc.ApprovalStatus,
            ApprovalCriticality: criticalityOf(tc.ApprovalStatus),
            IsRegressionRelevant: scope.IsRegressionRelevant !== false,
            ResultInRelease: result,
            ResultCriticality: result ? criticalityOf(result) : 0,
            ExternalExecutionID: run?.ExternalExecutionID || '',
            ExecutedVersion: run ? Number(run.TestCaseVersion) || 0 : 0,
            ExecutedAt: run?.StartedAt || null,
            ExecutedBy: run?.ExecutedBy || '',
            RunType: run?.RunType || '',
            Remark: remarks.join('; ').slice(0, 255)
        };
    });
    await replaceRows(repo, 'ReleaseTestCase', 'ReleaseTestCaseUUID', { ReleaseID: releaseId }, caseRows);

    // coverage per process step of the processes in scope
    const coverageRows = [];
    const covered = new Map(); // StepID → PASSED | FAILED | NOT_EXECUTED ...
    for (const processId of [...new Set(scopes.map((sc) => sc.ProcessID))]) {
        const steps = [...(state.stepsByProcess.get(processId) || [])].sort((a, b) => a.Sequence - b.Sequence);
        for (const step of steps) {
            const designCases = testCases.filter(
                (tc) => tc.BusinessProcess === processId && (state.testStepsByCase.get(tc.TestCaseUUID) || []).some((ts) => ts.ProcessStepID === step.StepID)
            );
            let executed = 0;
            let passed = 0;
            let failed = 0;
            let latestDocument = '';
            for (const tc of designCases) {
                const run = latestRun(state, tc.TestCaseUUID, releaseId);
                const result = stepResult(state, run, step, tc);
                if (result) {
                    executed++;
                    if (result === 'PASSED') {
                        passed++;
                    } else {
                        failed++;
                    }
                }
                const doc = run && (state.documentsByRun.get(run.ExecutionUUID) || []).find((d) => d.ProcessStepID === step.StepID);
                if (doc && !latestDocument) {
                    latestDocument = doc.DocumentID;
                }
            }
            let status;
            let remark = '';
            if (step.PilotScope !== catalog.PILOT) {
                status = COVERAGE.LATER;
                remark = 'Later API extension, not part of the pilot.';
            } else if (step.Automation === catalog.AUTOMATION.MANUAL) {
                status = COVERAGE.MANUAL;
                remark = 'Manual / external step: verified through the following documents.';
            } else if (!designCases.length) {
                status = COVERAGE.NOT_COVERED;
                remark = 'No test case of the scope runs through this step.';
            } else if (failed) {
                status = COVERAGE.FAILED;
            } else if (!executed) {
                status = COVERAGE.NOT_EXECUTED;
            } else {
                status = COVERAGE.PASSED;
            }
            if (!remark && step.TeamAssignment !== ASSIGNMENT.ASSIGNED) {
                remark = step.TeamAssignment === ASSIGNMENT.ASSUMED ? 'Responsible team is an assumption – to be confirmed.' : 'Responsible team open.';
            }
            covered.set(step.StepID, status);
            coverageRows.push({
                CoverageUUID: stableUUID(`ReleaseStepCoverage|${releaseId}|${processId}|${step.StepID}`),
                ReleaseID: releaseId,
                ProcessID: processId,
                Sequence: step.Sequence,
                StepID: step.StepID,
                StepName: step.StepName,
                BusinessObjectType: step.BusinessObjectType || '',
                ResponsibleTeam: step.ResponsibleTeam || '',
                TeamAssignment: step.TeamAssignment || ASSIGNMENT.OPEN,
                IsHandover: step.IsHandover === true,
                Automation: step.Automation,
                TestCaseCount: designCases.length,
                ExecutedCount: executed,
                PassedCount: passed,
                FailedCount: failed,
                CoverageStatus: status,
                CoverageCriticality: criticalityOf(status),
                LatestDocumentID: latestDocument,
                Remark: remark
            });
        }
    }
    await replaceRows(repo, 'ReleaseStepCoverage', 'CoverageUUID', { ReleaseID: releaseId }, coverageRows);
    const measurable = (rows) => rows.filter((r) => r.CoverageStatus !== COVERAGE.LATER && r.CoverageStatus !== COVERAGE.MANUAL);

    // KPIs per scope entry (team × process)
    for (const scope of scopes) {
        const cases = caseRows.filter((r) => r.ProcessTeam === scope.ProcessTeam && r.ProcessID === scope.ProcessID);
        const executed = cases.filter((r) => r.ResultInRelease).length;
        const passedCount = cases.filter((r) => PASSED_RESULTS.has(r.ResultInRelease)).length;
        const failedCount = cases.filter((r) => FAILED_RESULTS.has(r.ResultInRelease)).length;
        const approved = cases.filter((r) => r.ApprovalStatus === APPROVAL.APPROVED && r.ApprovedVersion === r.TestCaseVersion).length;
        // the team's sub-process: process steps the team is responsible for (owner team: all steps without another team)
        const process = state.processes.find((p) => p.ProcessID === scope.ProcessID);
        const teamSteps = measurable(coverageRows.filter((r) => r.ProcessID === scope.ProcessID)).filter(
            (r) => r.ResponsibleTeam === scope.ProcessTeam || (process?.OwnerTeam === scope.ProcessTeam && !r.ResponsibleTeam)
        );
        const coveredSteps = teamSteps.filter((r) => r.CoverageStatus === COVERAGE.PASSED).length;
        let status;
        if (!(state.stepsByProcess.get(scope.ProcessID) || []).length) {
            status = COVERAGE.OPEN;
        } else if (!cases.length) {
            status = COVERAGE.NOT_COVERED;
        } else if (failedCount) {
            status = COVERAGE.FAILED;
        } else if (cases.some((r) => /run in progress/.test(r.Remark))) {
            status = COVERAGE.IN_PROGRESS;
        } else if (!executed) {
            status = COVERAGE.NOT_EXECUTED;
        } else if (executed < approved || coveredSteps < teamSteps.length) {
            status = COVERAGE.IN_PROGRESS;
        } else {
            status = COVERAGE.PASSED;
        }
        await repo.update(
            'ReleaseScope',
            { ScopeUUID: scope.ScopeUUID, IsActiveEntity: true },
            {
                TestCaseCount: cases.length,
                ApprovedCount: approved,
                ExecutedCount: executed,
                PassedCount: passedCount,
                FailedCount: failedCount,
                PassRate: percent(passedCount, executed),
                StepCoverage: percent(coveredSteps, teamSteps.length),
                ScopeStatus: status,
                ScopeStatusCriticality: criticalityOf(status)
            }
        );
    }

    // release KPIs
    const executed = caseRows.filter((r) => r.ResultInRelease).length;
    const passedCount = caseRows.filter((r) => PASSED_RESULTS.has(r.ResultInRelease)).length;
    const measurableRows = measurable(coverageRows);
    const coveredCount = measurableRows.filter((r) => r.CoverageStatus === COVERAGE.PASSED).length;
    const passRate = executed ? percent(passedCount, executed) : null;
    const coverage = measurableRows.length ? percent(coveredCount, measurableRows.length) : null;
    const latest = state.runs.filter((r) => r.ReleaseID === releaseId).sort((a, b) => String(b.StartedAt).localeCompare(String(a.StartedAt)))[0];
    await repo.update(
        'Release',
        { ReleaseID: releaseId, IsActiveEntity: true },
        {
            ScopeCount: scopes.length,
            TestCaseCount: caseRows.length,
            ApprovedCount: caseRows.filter((r) => r.ApprovalStatus === APPROVAL.APPROVED && r.ApprovedVersion === r.TestCaseVersion).length,
            ExecutedCount: executed,
            PassedCount: passedCount,
            FailedCount: caseRows.filter((r) => FAILED_RESULTS.has(r.ResultInRelease)).length,
            PassRate: passRate ?? 0,
            PassRateCriticality: criticalityOfPercent(passRate),
            StepCoverage: coverage ?? 0,
            // no run in this release yet: no judgement (neutral) instead of a red 0 %
            StepCoverageCriticality: executed ? criticalityOfPercent(coverage) : 0,
            LatestRunUUID: latest?.RunUUID || null,
            LatestRunID: latest?.RunID || '',
            LatestRunStatus: latest?.Status || '',
            LatestRunCriticality: latest ? criticalityOf(latest.Status) : 0,
            LatestRunAt: latest?.StartedAt || null
        }
    );
}

/** Items and KPIs of the regression runs, taken from their executions */
async function refreshRuns(repo, state) {
    for (const run of state.runs) {
        const items = await repo.find('RegressionRunItem', { RunUUID: run.RunUUID });
        // test cases waiting for their predecessor keep the run running
        let running = items.filter((item) => item.Decision === 'WAITING').length;
        let passed = 0;
        let failed = 0;
        for (const item of items) {
            if (!item.ExecutionUUID) {
                continue;
            }
            const execution = state.executions.find((e) => e.ExecutionUUID === item.ExecutionUUID);
            if (!execution) {
                continue;
            }
            const finished = execution.Status !== EXECUTION.RUNNING;
            const result = finished ? execution.FunctionalResult || '' : '';
            running += finished ? 0 : 1;
            passed += PASSED_RESULTS.has(result) ? 1 : 0;
            failed += FAILED_RESULTS.has(result) ? 1 : 0;
            await repo.update(
                'RegressionRunItem',
                { RunItemUUID: item.RunItemUUID },
                { ExecutionStatus: execution.Status, FinalResult: result, ResultCriticality: result ? criticalityOf(result) : criticalityOf(execution.Status) }
            );
        }
        const done = passed + failed;
        const status = running ? EXECUTION.RUNNING : EXECUTION.FINISHED;
        const patch = {
            RunningCount: running,
            PassedCount: passed,
            FailedCount: failed,
            PassRate: percent(passed, done),
            PassRateCriticality: criticalityOfPercent(done ? percent(passed, done) : null),
            Status: status,
            StatusCriticality: criticalityOf(status)
        };
        if (!running && run.Status === EXECUTION.RUNNING) {
            const finishedAt = state.executions
                .filter((e) => items.some((i) => i.ExecutionUUID === e.ExecutionUUID))
                .map((e) => e.FinishedAt)
                .filter(Boolean)
                .sort()
                .pop();
            patch.FinishedAt = finishedAt || run.StartedAt;
        }
        await repo.update('RegressionRun', { RunUUID: run.RunUUID }, patch);
        Object.assign(run, patch);
    }
}

/** Counters on teams, processes, steps and variants */
async function refreshCounters(repo, state) {
    for (const team of state.teams) {
        const owned = state.processes.filter((p) => p.OwnerTeam === team.ProcessTeam).map((p) => p.ProcessID);
        const allSteps = [...state.stepsByProcess.values()].flat();
        await repo.update(
            'ProcessTeam',
            { ProcessTeam: team.ProcessTeam, IsActiveEntity: true },
            {
                ProcessOwnerCount: state.members.filter((m) => m.ProcessTeam === team.ProcessTeam && m.TeamRole === TEAM_ROLE.PROCESS_OWNER).length,
                TestExecutorCount: state.members.filter((m) => m.ProcessTeam === team.ProcessTeam && m.TeamRole === TEAM_ROLE.TEST_EXECUTOR).length,
                ResponsibleStepCount: allSteps.filter((st) => st.ResponsibleTeam === team.ProcessTeam).length,
                TestCaseCount: state.testCases.filter((tc) => tc.ProcessTeam === team.ProcessTeam).length,
                OpenAssignmentCount: allSteps.filter((st) => owned.includes(st.ProcessID) && st.TeamAssignment !== ASSIGNMENT.ASSIGNED).length
            }
        );
    }
    for (const process of state.processes) {
        const cases = state.testCases.filter((tc) => tc.BusinessProcess === process.ProcessID);
        await repo.update('BusinessProcess', { ProcessID: process.ProcessID, IsActiveEntity: true }, { TestCaseCount: cases.length });
        for (const step of state.stepsByProcess.get(process.ProcessID) || []) {
            const count = cases.filter((tc) => (state.testStepsByCase.get(tc.TestCaseUUID) || []).some((ts) => ts.ProcessStepID === step.StepID)).length;
            await repo.update('ProcessStep', { ProcessStepUUID: step.ProcessStepUUID, IsActiveEntity: true }, { TestCaseCount: count });
        }
        for (const variant of state.variantsByProcess.get(process.ProcessID) || []) {
            const count = cases.filter((tc) => tc.ProcessVariant === variant.Variant).length;
            await repo.update('ProcessVariant', { VariantUUID: variant.VariantUUID, IsActiveEntity: true }, { TestCaseCount: count });
        }
    }
}

/** Process assignment of all active test cases (a changed process model can open or close assignments) */
async function refreshAssignments(repo, state) {
    const teams = new Set(state.teams.filter((t) => t.IsActive !== false).map((t) => t.ProcessTeam));
    for (const tc of state.testCases) {
        const model = {
            process: state.processes.find((p) => p.ProcessID === tc.BusinessProcess),
            steps: state.stepsByProcess.get(tc.BusinessProcess) || [],
            variants: state.variantsByProcess.get(tc.BusinessProcess) || []
        };
        const { status, note } = assignmentOf(tc, model, teams);
        if (status !== tc.AssignmentStatus || note.slice(0, 255) !== tc.AssignmentNote) {
            await repo.update(
                'TestCase',
                { TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: true },
                { AssignmentStatus: status, AssignmentCriticality: criticalityOf(status), AssignmentNote: note.slice(0, 255) }
            );
            tc.AssignmentStatus = status;
        }
    }
}

/**
 * Recomputes all read models (small data volumes in the mockup).
 *
 * @param {object} repo repository
 */
/** Value help of the active test cases (selection of a predecessor test case) */
async function refreshTestCaseValueHelp(repo, state) {
    const rows = state.testCases
        .filter((tc) => tc.CaseID)
        .sort((a, b) => String(a.CaseID).localeCompare(String(b.CaseID)))
        .map((tc) => ({
            CaseID: tc.CaseID,
            Title: tc.Title || '',
            ProcessTeam: tc.ProcessTeam || '',
            BusinessProcess: tc.BusinessProcess || '',
            ProcessVariant: tc.ProcessVariant || '',
            StartObject: tc.StartObject || '',
            EndObject: tc.EndObject || '',
            ApprovalStatus: tc.ApprovalStatus || '',
            LatestResult: tc.FinalResult || ''
        }));
    await replaceRows(repo, 'TestCaseVH', 'CaseID', {}, rows);
}

async function refreshAll(repo) {
    const state = await loadState(repo);
    await refreshTestCaseValueHelp(repo, state);
    await refreshAssignments(repo, state);
    await refreshRuns(repo, state);
    for (const release of state.releases) {
        await refreshRelease(repo, state, release);
    }
    await refreshCounters(repo, state);
}

module.exports = { refreshAll, latestRun };
