'use strict';
/**
 * ITestExecutionProvider — execution adapter between the approved test case and a test automation tool.
 *
 * The five methods correspond to the five points that are OPEN for the SAP standard test automation
 * (prompt.md §2.3 / §5.5, docs/phase-1 section 3.9):
 *   (1) external start            → start()
 *   (2) test data handover        → start(validatedDataset, ...)
 *   (3) status                    → getStatus()
 *   (4) result                    → getResult()
 *   (5) document number return    → getCreatedDocuments()   (fallback: document correlation via Case ID)
 *
 * Implementations:
 *   - MockExecutionProvider (this project): MOCK, simulates an asynchronous run (see MockExecutionProvider.js)
 *   - real adapters (SAP Cloud ALM + Test Automation Tool, Tricentis Test Automation for SAP, direct API chain):
 *     ⚠ NOCH ZU VERIFIZIEREN — none of them is implemented here.
 */
class ITestExecutionProvider {
    /** @returns {string} provider code (code list ExecutionProviderVH) */
    get code() {
        throw new Error('not implemented');
    }

    /**
     * (1) + (2) Starts an execution with the validated test data set.
     *
     * @param {object} validatedDataset approved test data (TestCaseData + process profile)
     * @param {object} correlation correlation data, e.g. { caseId, soldToParty }
     * @returns {{externalExecutionId:string}} external execution ID
     */
    // eslint-disable-next-line no-unused-vars
    start(validatedDataset, correlation) {
        throw new Error('not implemented');
    }

    /**
     * (3) Status of an execution.
     *
     * @param {string} externalExecutionId ID returned by start
     * @returns {{status:string, progressPercent:number, steps:object[]}} status incl. steps per business object
     */
    // eslint-disable-next-line no-unused-vars
    getStatus(externalExecutionId) {
        throw new Error('not implemented');
    }

    /**
     * (4) Technical result and log of an execution.
     *
     * @param {string} externalExecutionId ID returned by start
     * @returns {{technicalResult:'OK'|'ERROR', log:string[]}} result
     */
    // eslint-disable-next-line no-unused-vars
    getResult(externalExecutionId) {
        throw new Error('not implemented');
    }

    /**
     * (5) Documents created by the execution.
     *
     * @param {string} externalExecutionId ID returned by start
     * @returns {object[]} documents { businessObjectType, documentId, predecessorId, successorId, lifecycleStatus, netAmount, currency }
     */
    // eslint-disable-next-line no-unused-vars
    getCreatedDocuments(externalExecutionId) {
        throw new Error('not implemented');
    }

    /**
     * Cancels a running execution.
     *
     * @param {string} externalExecutionId ID returned by start
     */
    // eslint-disable-next-line no-unused-vars
    cancel(externalExecutionId) {
        throw new Error('not implemented');
    }
}

module.exports = { ITestExecutionProvider };
