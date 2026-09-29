'use strict';
/**
 * MockExecutionProvider — MOCK implementation of ITestExecutionProvider.
 *
 * It does NOT call any SAP test automation. It simulates an asynchronous run:
 *   start() hands over the validated data set and returns an external execution ID ("MOCK-<date>-<no>"),
 *   getStatus() advances the run by elapsed time (SIM-1: one chain step every stepDurationMs),
 *   each finished step creates one document in MockS4ServiceChain, getCreatedDocuments() returns the numbers.
 *
 * Every method below is a stand-in for an OPEN point of the real integration (⚠ NOCH ZU VERIFIZIEREN, F-8).
 */
const { ITestExecutionProvider } = require('./ITestExecutionProvider');
const { CHAIN, MockS4ServiceChain, MockS4DocumentStore } = require('./MockS4ServiceChain');
const numberRanges = require('../common/numberRanges');
const clock = require('../common/clock');
const { EXECUTION, STEP_STATUS } = require('../common/codes');

const DEFAULT_STEP_DURATION_MS = 2000;

class MockExecutionProvider extends ITestExecutionProvider {
    /**
     * @param {object} options options
     * @param {string} options.tenantId tenant of the mock session
     * @param {number} [options.stepDurationMs] simulated duration of one chain step
     */
    constructor({ tenantId, stepDurationMs = DEFAULT_STEP_DURATION_MS }) {
        super();
        this.tenantId = tenantId;
        this.stepDurationMs = stepDurationMs;
        this.store = new MockS4DocumentStore();
        this.chain = new MockS4ServiceChain({ tenantId, store: this.store });
        this.runs = new Map();
    }

    get code() {
        return 'MOCK';
    }

    /** MOCK — real to be clarified (F-8): (1) external start and (2) test data handover */
    start(validatedDataset, correlation) {
        const externalExecutionId = numberRanges.nextExecutionId(this.tenantId);
        const startedAt = clock.now();
        this.runs.set(externalExecutionId, {
            externalExecutionId,
            dataset: validatedDataset,
            correlation,
            startedAt,
            status: EXECUTION.RUNNING,
            documents: [],
            steps: CHAIN.map((step) => ({ ...step, status: STEP_STATUS.PLANNED, actualStatus: '', startedAt: null, finishedAt: null, message: '' })),
            log: [
                `${new Date(startedAt).toISOString()} MOCK start: external execution ${externalExecutionId} for ${correlation.caseId} (provider MockExecutionProvider, no SAP test automation called)`,
                `${new Date(startedAt).toISOString()} MOCK test data handover: ${Object.keys(validatedDataset.data).length} fields, process profile ${validatedDataset.processProfile}`
            ]
        });
        return { externalExecutionId };
    }

    run(externalExecutionId) {
        const run = this.runs.get(externalExecutionId);
        if (!run) {
            throw new Error(`Unknown external execution ${externalExecutionId} (mock runs are lost when the mock server restarts)`);
        }
        return run;
    }

    /** Advances the simulated run up to the current time (SIM-1) */
    advance(run) {
        if (run.status !== EXECUTION.RUNNING) {
            return;
        }
        const now = clock.now();
        for (const step of run.steps) {
            if (step.status === STEP_STATUS.DONE) {
                continue;
            }
            const startAt = run.startedAt + (step.sequence - 1) * this.stepDurationMs;
            const doneAt = run.startedAt + step.sequence * this.stepDurationMs;
            if (now < startAt) {
                break;
            }
            step.startedAt = step.startedAt || new Date(startAt).toISOString();
            if (now < doneAt) {
                step.status = STEP_STATUS.RUNNING;
                break;
            }
            const result = this.chain.executeStep(run, step);
            step.finishedAt = new Date(doneAt).toISOString();
            step.actualStatus = result.actualStatus;
            step.message = result.message;
            run.log.push(`${step.finishedAt} step ${step.sequence} ${step.businessObjectType}: ${result.message}`);
            if (!result.ok) {
                step.status = STEP_STATUS.FAILED;
                run.status = EXECUTION.FAILED;
                run.finishedAt = doneAt;
                for (const rest of run.steps.filter((s) => s.status === STEP_STATUS.PLANNED)) {
                    rest.status = STEP_STATUS.SKIPPED;
                    rest.message = 'Skipped after failed predecessor step.';
                }
                return;
            }
            step.status = STEP_STATUS.DONE;
        }
        if (run.steps.every((s) => s.status === STEP_STATUS.DONE)) {
            run.status = EXECUTION.FINISHED;
            run.finishedAt = run.startedAt + run.steps.length * this.stepDurationMs;
            run.log.push(`${new Date(run.finishedAt).toISOString()} MOCK run finished`);
        }
    }

    /** MOCK — real to be clarified (F-8): (3) status */
    getStatus(externalExecutionId) {
        const run = this.run(externalExecutionId);
        this.advance(run);
        const done = run.steps.filter((s) => s.status === STEP_STATUS.DONE).length;
        return {
            status: run.status,
            progressPercent: Math.round((done / run.steps.length) * 100),
            steps: run.steps.map((s) => ({ ...s })),
            startedAt: new Date(run.startedAt).toISOString(),
            finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null
        };
    }

    /** MOCK — real to be clarified (F-8): (4) result */
    getResult(externalExecutionId) {
        const run = this.run(externalExecutionId);
        return { technicalResult: run.status === EXECUTION.FAILED ? 'ERROR' : 'OK', log: [...run.log] };
    }

    /** MOCK — real to be clarified (F-8): (5) document number return (real fallback: document correlation via Case ID) */
    getCreatedDocuments(externalExecutionId) {
        const run = this.run(externalExecutionId);
        return run.documents.map((d) => ({ ...d }));
    }

    cancel(externalExecutionId) {
        const run = this.run(externalExecutionId);
        this.advance(run);
        if (run.status === EXECUTION.RUNNING) {
            run.status = EXECUTION.CANCELLED;
            run.finishedAt = clock.now();
            for (const step of run.steps.filter((s) => s.status === STEP_STATUS.PLANNED || s.status === STEP_STATUS.RUNNING)) {
                step.status = STEP_STATUS.SKIPPED;
                step.message = 'Skipped: execution cancelled.';
            }
            run.log.push(`${new Date(run.finishedAt).toISOString()} MOCK run cancelled by user`);
        }
    }

    /** Read access to the simulated S/4HANA documents (stand-in for the released OData APIs) */
    readDocument(businessObjectType, documentId) {
        return this.store.read(businessObjectType, documentId);
    }
}

/** Provider that simulates an outage (process profile FS_TM_OUTAGE, execution provider MOCK_UNAVAILABLE) */
class UnavailableMockProvider extends ITestExecutionProvider {
    get code() {
        return 'MOCK_UNAVAILABLE';
    }

    start() {
        const error = new Error('Execution provider is not reachable (simulated outage, mock rule SIM-8). Try again later or choose another process profile.');
        error.technical = true;
        throw error;
    }
}

const providersByTenant = new Map();

/**
 * Returns the provider for a code (registry). Only the mock providers exist in the mockup.
 *
 * @param {string} code ExecutionProvider code of the process profile
 * @param {string} tenantId tenant
 * @returns {ITestExecutionProvider|undefined} provider or undefined when not connected
 */
function getProvider(code, tenantId) {
    if (!providersByTenant.has(tenantId)) {
        providersByTenant.set(tenantId, { MOCK: new MockExecutionProvider({ tenantId }), MOCK_UNAVAILABLE: new UnavailableMockProvider() });
    }
    return providersByTenant.get(tenantId)[code];
}

/** Test helper: drops all provider instances */
function resetProviders() {
    providersByTenant.clear();
}

module.exports = { MockExecutionProvider, UnavailableMockProvider, getProvider, resetProviders, DEFAULT_STEP_DURATION_MS };
