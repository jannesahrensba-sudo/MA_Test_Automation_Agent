'use strict';
/**
 * ReleaseService — behavior of the BO "release" (SAP release cycle or internal process team release) with its scope
 * link table release × process team × business process (version):
 *   - initial values, determinations and validations of the scope (draft),
 *   - copyScopeFromPredecessor: the regression scope travels from release to release,
 *   - startRegressionRun: runs all approved test cases of the regression-relevant scope with the same server-side
 *     checks as a single run; test cases that may not run are skipped with the reason,
 *   - startTeamRegressionRun ("team run"): the same run restricted to one process team (optionally one process), with
 *     the reason (e.g. a code change in the process) and optionally the dependent test cases of other teams,
 *   - refreshRegressionRun: advances the runs (mock provider) and aggregates the results,
 *   - automatic regression run when a release with "Regression at Test Start" changes to IN_TEST (stand-in for a
 *     scheduled job, ⚠ target: application job or SAP Cloud ALM test plan scheduling, to verify).
 */
const testCases = require('./TestCaseService');
const traceability = require('./TraceabilityService');
const { isEmpty } = require('../validation/ValidationEngine');
const { RELEASE_STATUS, EXECUTION, RESULT, RUN_TYPE, RUN_DECISION, VALIDATION, criticalityOf } = require('../common/codes');

/** results of a predecessor run that hand its documents over to the waiting test case */
const HANDOVER_RESULTS = new Set([RESULT.PASSED, RESULT.PASSED_WITH_WARNING]);
const { CATEGORY, SEVERITY, sapMessage, MockServiceError } = require('../common/messages');
const clock = require('../common/clock');
const { newUUID: uuid } = require('../common/uuid');

const CURRENT_USER = testCases.CURRENT_USER;
const relKeys = (release) => ({ ReleaseID: release.ReleaseID, IsActiveEntity: release.IsActiveEntity });

async function getRelease(repo, keys) {
    const release = await repo.findOne('Release', { ReleaseID: keys.ReleaseID, IsActiveEntity: keys.IsActiveEntity });
    if (!release) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 299, `Release ${keys.ReleaseID} not found.`);
    }
    return release;
}

/* ------------------------------------------------------------------------------------------------ */
/* Derived state and feature control                                                                 */
/* ------------------------------------------------------------------------------------------------ */
function deriveRelease(release) {
    const isDraft = release.IsActiveEntity === false;
    const lockedByDraft = release.IsActiveEntity !== false && release.HasDraftEntity === true;
    const running = release.LatestRunStatus === EXECUTION.RUNNING;
    return {
        ReleaseStatusCriticality: criticalityOf(release.ReleaseStatus),
        __OperationControl: {
            startRegressionRun: !isDraft && !lockedByDraft && !running && release.ReleaseStatus === RELEASE_STATUS.IN_TEST,
            startTeamRegressionRun: !isDraft && !lockedByDraft && !running && release.ReleaseStatus === RELEASE_STATUS.IN_TEST,
            refreshRegressionRun: !isDraft && running,
            copyScopeFromPredecessor:
                !isDraft &&
                !lockedByDraft &&
                !isEmpty(release.PredecessorRelease) &&
                (release.ReleaseStatus === RELEASE_STATUS.PLANNED || release.ReleaseStatus === RELEASE_STATUS.IN_TEST)
        },
        __EntityControl: { Updatable: !running, Deletable: false }
    };
}

async function syncDerived(repo, releaseId) {
    for (const release of await repo.find('Release', { ReleaseID: releaseId })) {
        await repo.update('Release', relKeys(release), deriveRelease(release));
    }
}

function initialRelease(release) {
    return {
        ReleaseName: release.ReleaseName || '',
        ReleaseType: release.ReleaseType || 'INTERNAL',
        ReleaseStatus: release.ReleaseStatus || RELEASE_STATUS.PLANNED,
        AutoRegression: release.AutoRegression ?? true,
        ScopeCount: 0,
        TestCaseCount: 0,
        ApprovedCount: 0,
        ExecutedCount: 0,
        PassedCount: 0,
        FailedCount: 0,
        PassRate: 0,
        PassRateCriticality: 0,
        StepCoverage: 0,
        StepCoverageCriticality: 0,
        LatestRunUUID: null,
        LatestRunID: '',
        LatestRunStatus: '',
        LatestRunCriticality: 0,
        LatestRunAt: null,
        SAP__Messages: [],
        ...deriveRelease({ ...release, IsActiveEntity: false, ReleaseStatus: release.ReleaseStatus || RELEASE_STATUS.PLANNED })
    };
}

/** Default values of a new scope entry: the team's pilot process in its current version, part of the regression */
async function initialScope(repo, row) {
    const patch = { IsRegressionRelevant: row.IsRegressionRelevant ?? true, ScopeNote: row.ScopeNote || '' };
    Object.assign(patch, await scopeDefaults(repo, { ...row, ...patch }));
    return {
        TestCaseCount: 0,
        ApprovedCount: 0,
        ExecutedCount: 0,
        PassedCount: 0,
        FailedCount: 0,
        PassRate: 0,
        StepCoverage: 0,
        ScopeStatus: 'NOT_COVERED',
        ScopeStatusCriticality: criticalityOf('NOT_COVERED'),
        ...patch
    };
}

/** Determination on modify of a scope entry: process of the team, current process version */
async function scopeDefaults(repo, row, changed = ['ProcessTeam', 'ProcessID']) {
    const patch = {};
    let processId = row.ProcessID;
    if (changed.includes('ProcessTeam') && row.ProcessTeam && isEmpty(processId)) {
        const owned = (await repo.find('BusinessProcessVH', { OwnerTeam: row.ProcessTeam }))[0];
        if (owned) {
            processId = owned.ProcessID;
            patch.ProcessID = processId;
        }
    }
    if (changed.includes('ProcessID') || patch.ProcessID) {
        const process = processId ? await repo.findOne('BusinessProcessVH', { ProcessID: processId }) : undefined;
        patch.ProcessVersion = process ? process.ProcessVersion : null;
    }
    return patch;
}

/**
 * Validation on save (Prepare) of a release draft.
 *
 * @param {object} repo repository
 * @param {string} releaseId release
 */
async function validateRelease(repo, releaseId) {
    const release = await repo.findOne('Release', { ReleaseID: releaseId, IsActiveEntity: false });
    if (!release) {
        return;
    }
    if (isEmpty(release.ReleaseName)) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 150, 'Enter a name for the release.', 'ReleaseName');
    }
    if (release.TestStartDate && release.TestEndDate && release.TestStartDate > release.TestEndDate) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 151, 'The test end is before the test start.', 'TestEndDate');
    }
    if (release.PredecessorRelease === releaseId) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 152, 'A release cannot be its own predecessor.', 'PredecessorRelease');
    }
    const teams = new Set((await repo.find('ProcessTeamVH')).map((t) => t.ProcessTeam));
    const processes = new Map((await repo.find('BusinessProcessVH')).map((p) => [p.ProcessID, p]));
    const seen = new Set();
    for (const scope of await repo.find('ReleaseScope', { ReleaseID: releaseId, IsActiveEntity: false })) {
        if (!teams.has(scope.ProcessTeam)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 153, `Scope: process team "${scope.ProcessTeam || ''}" does not exist.`);
        }
        const process = processes.get(scope.ProcessID);
        if (!process) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 154, `Scope of ${scope.ProcessTeam}: process "${scope.ProcessID || ''}" does not exist.`);
        }
        const version = Number(scope.ProcessVersion);
        if (scope.ProcessVersion !== null && scope.ProcessVersion !== undefined && (version < 0 || version > Number(process.ProcessVersion))) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 155, `Scope of ${scope.ProcessTeam}: process ${scope.ProcessID} has no version ${scope.ProcessVersion} (current ${process.ProcessVersion}).`);
        }
        const key = `${scope.ProcessTeam}|${scope.ProcessID}`;
        if (seen.has(key)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 156, `Scope: ${scope.ProcessTeam} with process ${scope.ProcessID} is maintained more than once.`);
        }
        seen.add(key);
    }
}

/** Read model ReleaseVH (value help of releases) */
async function syncReleaseValueHelp(repo, releaseId) {
    const release = await repo.findOne('Release', { ReleaseID: releaseId, IsActiveEntity: true });
    const vh = await repo.findOne('ReleaseVH', { ReleaseID: releaseId });
    if (!release) {
        return;
    }
    const row = {
        ReleaseID: releaseId,
        ReleaseName: release.ReleaseName,
        ReleaseType: release.ReleaseType,
        ReleaseStatus: release.ReleaseStatus,
        TestStartDate: release.TestStartDate || null,
        TestEndDate: release.TestEndDate || null
    };
    if (vh) {
        await repo.update('ReleaseVH', { ReleaseID: releaseId }, row);
    } else {
        await repo.add('ReleaseVH', row);
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* Actions                                                                                           */
/* ------------------------------------------------------------------------------------------------ */
/**
 * Copies the scope entries of the predecessor release (missing entries only, current process versions).
 *
 * @param {object} repo repository
 * @param {object} keys release keys (active)
 * @returns {Promise<{release: object, messages: object[]}>} result
 */
async function copyScopeFromPredecessor(repo, keys) {
    const release = await getRelease(repo, keys);
    if (isEmpty(release.PredecessorRelease)) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 250, 'Maintain the predecessor release first.', 'PredecessorRelease');
    }
    const source = await repo.find('ReleaseScope', { ReleaseID: release.PredecessorRelease, IsActiveEntity: true });
    const existing = await repo.find('ReleaseScope', { ReleaseID: release.ReleaseID, IsActiveEntity: true });
    const processes = new Map((await repo.find('BusinessProcessVH')).map((p) => [p.ProcessID, p]));
    let copied = 0;
    for (const scope of source) {
        if (existing.some((e) => e.ProcessTeam === scope.ProcessTeam && e.ProcessID === scope.ProcessID)) {
            continue;
        }
        await repo.add('ReleaseScope', {
            ScopeUUID: uuid(),
            ReleaseID: release.ReleaseID,
            IsActiveEntity: true,
            HasActiveEntity: false,
            HasDraftEntity: false,
            DraftAdministrativeData: null,
            ProcessTeam: scope.ProcessTeam,
            ProcessID: scope.ProcessID,
            ProcessVersion: processes.get(scope.ProcessID)?.ProcessVersion ?? scope.ProcessVersion,
            IsRegressionRelevant: scope.IsRegressionRelevant !== false,
            ScopeNote: `Copied from ${release.PredecessorRelease}`,
            TestCaseCount: 0,
            ApprovedCount: 0,
            ExecutedCount: 0,
            PassedCount: 0,
            FailedCount: 0,
            PassRate: 0,
            StepCoverage: 0,
            ScopeStatus: 'NOT_COVERED',
            ScopeStatusCriticality: criticalityOf('NOT_COVERED')
        });
        copied++;
    }
    await traceability.refreshAll(repo);
    return {
        release: await getRelease(repo, keys),
        messages: [
            sapMessage(
                910,
                copied
                    ? `${copied} scope entries copied from ${release.PredecessorRelease} (current process versions).`
                    : `The scope already contains all entries of ${release.PredecessorRelease}.`,
                { severity: SEVERITY.SUCCESS }
            )
        ]
    };
}

/** Next run ID of a release: REG-<release>-<no> */
async function nextRunId(repo, releaseId) {
    const runs = await repo.find('RegressionRun', { ReleaseID: releaseId });
    return `REG-${releaseId}-${String(runs.length + 1).padStart(2, '0')}`.slice(0, 30);
}

/**
 * Regression run: all test cases of the regression-relevant scope; each one passes the same server-side checks as a
 * single run (valid, approved version, assignment, execution authorization) or is skipped with the reason. A test case
 * that continues with the documents of a predecessor test case of the same run waits until the predecessor passed
 * (handover between process teams within the run) and is started by refreshRegressionRun.
 *
 * A team run restricts the candidates to the scope entries of one process team (and process); with includeDependents the
 * test cases of other teams in the scope that continue with the documents of a candidate (predecessor test case) join
 * the run and wait for their predecessor.
 *
 * @param {object} repo repository
 * @param {object} keys release keys (active)
 * @param {object} [options] options
 * @param {string} [options.user] user
 * @param {string} [options.trigger] MANUAL | TEST_START (automatic at test start) | TEAM_RUN
 * @param {string} [options.team] process team of a team run
 * @param {string} [options.processId] process of a team run (default: all processes of the team in the scope)
 * @param {string} [options.reason] reason of the run, e.g. "code change in the repair process"
 * @param {boolean} [options.includeDependents] dependent test cases of other teams join the team run
 * @returns {Promise<{release: object, messages: object[], run: object}>} result
 */
async function startRegressionRun(repo, keys, { user = CURRENT_USER, trigger = 'MANUAL', team = '', processId = '', reason = '', includeDependents = false } = {}) {
    const release = await getRelease(repo, keys);
    if (release.ReleaseStatus !== RELEASE_STATUS.IN_TEST) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 251, `Regression runs are started for releases in test; ${release.ReleaseID} is ${release.ReleaseStatus}.`);
    }
    if (release.LatestRunStatus === EXECUTION.RUNNING) {
        throw new MockServiceError(CATEGORY.EXECUTION_ERROR, 406, `Regression run ${release.LatestRunID} of ${release.ReleaseID} is still running.`);
    }
    const releaseScopes = (await repo.find('ReleaseScope', { ReleaseID: release.ReleaseID, IsActiveEntity: true })).filter((sc) => sc.IsRegressionRelevant !== false);
    if (!releaseScopes.length) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 252, `Release ${release.ReleaseID} has no regression-relevant scope. Maintain the scope or copy it from the predecessor release.`);
    }
    const scopes = team ? releaseScopes.filter((sc) => sc.ProcessTeam === team && (!processId || sc.ProcessID === processId)) : releaseScopes;
    if (!scopes.length) {
        throw new MockServiceError(
            CATEGORY.BUSINESS_ERROR,
            254,
            `Process team ${team}${processId ? ` with process ${processId}` : ''} is not in the regression-relevant scope of release ${release.ReleaseID}.`
        );
    }
    const active = await repo.find('TestCase', { IsActiveEntity: true });
    const inScope = (tc, entries) => entries.some((sc) => sc.ProcessTeam === tc.ProcessTeam && sc.ProcessID === tc.BusinessProcess);
    const selected = active.filter((tc) => inScope(tc, scopes));
    if (team && includeDependents) {
        // test cases of other teams that continue with the documents of a selected test case (transitively)
        let added = true;
        while (added) {
            added = false;
            const ids = new Set(selected.map((tc) => tc.CaseID));
            for (const tc of active) {
                if (!ids.has(tc.CaseID) && tc.PredecessorTestCase && ids.has(tc.PredecessorTestCase) && inScope(tc, releaseScopes)) {
                    selected.push(tc);
                    added = true;
                }
            }
        }
    }
    const candidates = selected.sort((a, b) => String(a.ProcessTeam).localeCompare(String(b.ProcessTeam)) || String(a.CaseID).localeCompare(String(b.CaseID)));
    const runUUID = uuid();
    const runId = await nextRunId(repo, release.ReleaseID);
    const now = clock.nowIso();
    let started = 0;
    let skipped = 0;
    let waiting = 0;
    let sequence = 0;
    const candidateIds = new Set(candidates.map((tc) => tc.CaseID));
    for (const tc of candidates) {
        sequence++;
        const item = {
            RunItemUUID: uuid(),
            RunUUID: runUUID,
            Sequence: sequence,
            TestCaseUUID: tc.TestCaseUUID,
            CaseID: tc.CaseID,
            Title: tc.Title,
            ProcessTeam: tc.ProcessTeam,
            ProcessVariant: tc.ProcessVariant,
            TestCaseVersion: Number(tc.Version) || 0,
            ExecutionUUID: null,
            ExternalExecutionID: '',
            ExecutionStatus: '',
            FinalResult: '',
            ResultCriticality: 0
        };
        let reason = '';
        let waitFor = '';
        if (tc.ValidationStatus !== VALIDATION.VALID) {
            reason = `Test data ${String(tc.ValidationStatus).toLowerCase().replace('_', ' ')}: validate the test case first.`;
        } else {
            const check = await testCases.executionCheck(repo, tc, { user, releaseId: release.ReleaseID, regressionRunUUID: runUUID });
            const dependent = tc.PredecessorTestCase && candidateIds.has(tc.PredecessorTestCase) && (check.ok || check.error.number === 211);
            if (dependent) {
                // the predecessor runs in this regression run: wait for its fresh documents
                waitFor = tc.PredecessorTestCase;
            } else if (!check.ok) {
                reason = check.error.message;
            }
        }
        if (waitFor) {
            waiting++;
            Object.assign(item, {
                Decision: RUN_DECISION.WAITING,
                DecisionCriticality: criticalityOf(RUN_DECISION.WAITING),
                Reason: `Waits for predecessor ${waitFor} in this run (handover of its documents).`
            });
            await repo.add('RegressionRunItem', item);
            continue;
        }
        if (!reason) {
            try {
                const result = await testCases.startExecution(
                    repo,
                    { TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: true },
                    { user, releaseId: release.ReleaseID, runType: RUN_TYPE.REGRESSION, regressionRunUUID: runUUID }
                );
                await testCases.syncDerived(repo, tc.TestCaseUUID);
                const execution = await repo.findOne('Execution', { ExecutionUUID: result.executionUUID, IsActiveEntity: true });
                Object.assign(item, {
                    ExecutionUUID: execution.ExecutionUUID,
                    ExternalExecutionID: execution.ExternalExecutionID,
                    ExecutionStatus: execution.Status,
                    ResultCriticality: criticalityOf(execution.Status)
                });
            } catch (error) {
                reason = error.message;
            }
        }
        if (reason) {
            skipped++;
            Object.assign(item, { Decision: RUN_DECISION.SKIPPED, DecisionCriticality: criticalityOf(RUN_DECISION.SKIPPED), Reason: reason.slice(0, 255) });
        } else {
            started++;
            Object.assign(item, { Decision: RUN_DECISION.STARTED, DecisionCriticality: criticalityOf(RUN_DECISION.STARTED), Reason: '' });
        }
        await repo.add('RegressionRunItem', item);
    }
    const status = started || waiting ? EXECUTION.RUNNING : EXECUTION.FINISHED;
    const run = {
        RunUUID: runUUID,
        RunID: runId,
        ReleaseID: release.ReleaseID,
        Status: status,
        StatusCriticality: criticalityOf(status),
        Trigger: team ? 'TEAM_RUN' : trigger,
        ProcessTeam: team || '',
        ProcessID: processId || '',
        RunReason: String(reason || '').slice(0, 120),
        IncludesDependents: !!(team && includeDependents),
        StartedAt: now,
        StartedBy: user,
        FinishedAt: started || waiting ? null : now,
        CandidateCount: candidates.length,
        StartedCount: started,
        SkippedCount: skipped,
        RunningCount: started + waiting,
        PassedCount: 0,
        FailedCount: 0,
        PassRate: 0,
        PassRateCriticality: 0
    };
    await repo.add('RegressionRun', run);
    await traceability.refreshAll(repo);
    await syncDerived(repo, release.ReleaseID);
    return {
        run,
        release: await getRelease(repo, keys),
        messages: [
            sapMessage(
                911,
                `${team ? `Team run ${runId} of ${team}${processId ? ` (${processId})` : ''}` : `Regression run ${runId}`} for ${release.ReleaseID}: ${started} of ${candidates.length} test cases started${
                    waiting ? `, ${waiting} waiting for their predecessor` : ''
                }, ${skipped} skipped (reasons in the run items). Results refresh automatically.`,
                { severity: started || waiting ? SEVERITY.SUCCESS : SEVERITY.WARNING }
            )
        ]
    };
}

/**
 * Team run: regression run of one process team (action startTeamRegressionRun with parameters).
 *
 * @param {object} repo repository
 * @param {object} keys release keys (active)
 * @param {object} parameters action parameters {ProcessTeam, ProcessID, RunReason, IncludeDependents}
 * @param {object} [options] options {user}
 * @returns {Promise<{release: object, messages: object[], run: object}>} result
 */
async function startTeamRegressionRun(repo, keys, parameters = {}, { user = CURRENT_USER } = {}) {
    const team = String(parameters.ProcessTeam || '').trim().toUpperCase();
    const processId = String(parameters.ProcessID || '').trim().toUpperCase();
    if (!team) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 255, 'Enter the process team whose test cases run.', 'ProcessTeam');
    }
    if (!(await repo.findOne('ProcessTeamVH', { ProcessTeam: team }))) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 256, `Process team ${team} does not exist.`, 'ProcessTeam');
    }
    if (processId && !(await repo.findOne('BusinessProcessVH', { ProcessID: processId }))) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 257, `Process ${processId} does not exist.`, 'ProcessID');
    }
    const includeDependents = parameters.IncludeDependents === true || parameters.IncludeDependents === 'true';
    return startRegressionRun(repo, keys, { user, team, processId, reason: parameters.RunReason, includeDependents });
}

/**
 * Advances the running executions of the latest regression run and aggregates the results.
 *
 * @param {object} repo repository
 * @param {object} keys release keys (active)
 * @returns {Promise<{release: object, messages: object[]}>} result
 */
async function refreshRegressionRun(repo, keys) {
    const release = await getRelease(repo, keys);
    if (!release.LatestRunUUID || release.LatestRunStatus !== EXECUTION.RUNNING) {
        return { release, messages: [] };
    }
    const items = await repo.find('RegressionRunItem', { RunUUID: release.LatestRunUUID });
    for (const item of items.filter((i) => i.ExecutionUUID)) {
        const execution = await repo.findOne('Execution', { ExecutionUUID: item.ExecutionUUID, IsActiveEntity: true });
        if (!execution || execution.Status !== EXECUTION.RUNNING) {
            continue;
        }
        const tcKeys = { TestCaseUUID: item.TestCaseUUID, IsActiveEntity: true };
        const tc = await repo.findOne('TestCase', tcKeys);
        // the test case may have started a newer run meanwhile: only the run of this regression is advanced
        if (tc && tc.LatestExecutionUUID === item.ExecutionUUID) {
            try {
                await testCases.refreshExecution(repo, tcKeys);
            } catch (error) {
                // a lost mock run is marked as failed by refreshExecution; the regression run continues
            }
            await testCases.syncDerived(repo, item.TestCaseUUID);
        }
    }
    await startWaitingItems(repo, release, items);
    await traceability.refreshAll(repo);
    await syncDerived(repo, release.ReleaseID);
    const updated = await getRelease(repo, keys);
    const messages = [];
    if (updated.LatestRunStatus !== EXECUTION.RUNNING) {
        const run = await repo.findOne('RegressionRun', { RunUUID: release.LatestRunUUID });
        messages.push(
            sapMessage(
                912,
                `${run.ProcessTeam ? 'Team run' : 'Regression run'} ${run.RunID} finished: ${run.PassedCount} passed, ${run.FailedCount} failed, ${run.SkippedCount} skipped (pass rate ${run.PassRate} %).`,
                { severity: run.FailedCount ? SEVERITY.WARNING : SEVERITY.SUCCESS }
            )
        );
    }
    return { release: updated, messages };
}

/**
 * Starts the test cases of a regression run that wait for their predecessor once it passed; a failed or skipped
 * predecessor hands nothing over, so the waiting test case is skipped with the reason.
 *
 * @param {object} repo repository
 * @param {object} release release (active)
 * @param {object[]} items run items of the latest regression run
 */
async function startWaitingItems(repo, release, items) {
    let changed = false;
    const run = items.length ? await repo.findOne('RegressionRun', { RunUUID: items[0].RunUUID }) : undefined;
    for (const item of items.filter((i) => i.Decision === RUN_DECISION.WAITING)) {
        const tc = await repo.findOne('TestCase', { TestCaseUUID: item.TestCaseUUID, IsActiveEntity: true });
        const predecessor = items.find((i) => i.CaseID === tc?.PredecessorTestCase);
        const predecessorRun = predecessor?.ExecutionUUID ? await repo.findOne('Execution', { ExecutionUUID: predecessor.ExecutionUUID, IsActiveEntity: true }) : undefined;
        let decision;
        let reason = '';
        let execution;
        if (!tc || !predecessor || predecessor.Decision === RUN_DECISION.SKIPPED) {
            decision = RUN_DECISION.SKIPPED;
            reason = `Predecessor ${tc?.PredecessorTestCase || ''} was skipped in this run: nothing to take over.`;
        } else if (predecessor.Decision === RUN_DECISION.WAITING || !predecessorRun || predecessorRun.Status === EXECUTION.RUNNING) {
            continue;
        } else if (!HANDOVER_RESULTS.has(predecessorRun.FunctionalResult)) {
            decision = RUN_DECISION.SKIPPED;
            reason = `Predecessor ${predecessor.CaseID} ended with ${predecessorRun.FunctionalResult || predecessorRun.Status}: nothing to take over.`;
        } else {
            try {
                const result = await testCases.startExecution(
                    repo,
                    { TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: true },
                    { user: run?.StartedBy || CURRENT_USER, releaseId: release.ReleaseID, runType: RUN_TYPE.REGRESSION, regressionRunUUID: item.RunUUID }
                );
                await testCases.syncDerived(repo, tc.TestCaseUUID);
                execution = await repo.findOne('Execution', { ExecutionUUID: result.executionUUID, IsActiveEntity: true });
                decision = RUN_DECISION.STARTED;
            } catch (error) {
                decision = RUN_DECISION.SKIPPED;
                reason = error.message;
            }
        }
        const patch = { Decision: decision, DecisionCriticality: criticalityOf(decision), Reason: reason.slice(0, 255) };
        if (execution) {
            Object.assign(patch, {
                ExecutionUUID: execution.ExecutionUUID,
                ExternalExecutionID: execution.ExternalExecutionID,
                ExecutionStatus: execution.Status,
                ResultCriticality: criticalityOf(execution.Status)
            });
        }
        await repo.update('RegressionRunItem', { RunItemUUID: item.RunItemUUID }, patch);
        Object.assign(item, patch);
        changed = true;
    }
    if (changed && run) {
        await repo.update(
            'RegressionRun',
            { RunUUID: run.RunUUID },
            {
                StartedCount: items.filter((i) => i.Decision === RUN_DECISION.STARTED).length,
                SkippedCount: items.filter((i) => i.Decision === RUN_DECISION.SKIPPED).length
            }
        );
    }
}

/**
 * After activation of a release: value help, read models and — when the release changed to IN_TEST and has
 * "Regression at Test Start" — the automatic regression run.
 *
 * @param {object} repo repository
 * @param {string} releaseId release
 * @param {string} [previousStatus] status before the activation
 * @returns {Promise<object[]>} messages
 */
async function onReleaseActivated(repo, releaseId, previousStatus) {
    await syncReleaseValueHelp(repo, releaseId);
    await traceability.refreshAll(repo);
    await syncDerived(repo, releaseId);
    const release = await repo.findOne('Release', { ReleaseID: releaseId, IsActiveEntity: true });
    if (release && release.ReleaseStatus === RELEASE_STATUS.IN_TEST && previousStatus !== RELEASE_STATUS.IN_TEST && release.AutoRegression) {
        try {
            const { messages } = await startRegressionRun(repo, { ReleaseID: releaseId, IsActiveEntity: true }, { trigger: 'TEST_START' });
            return messages;
        } catch (error) {
            return [sapMessage(253, `Automatic regression run not started: ${error.message}`, { severity: SEVERITY.WARNING })];
        }
    }
    return [];
}

module.exports = {
    deriveRelease,
    syncDerived,
    initialRelease,
    initialScope,
    scopeDefaults,
    validateRelease,
    syncReleaseValueHelp,
    copyScopeFromPredecessor,
    startRegressionRun,
    startTeamRegressionRun,
    refreshRegressionRun,
    onReleaseActivated
};
