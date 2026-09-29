'use strict';
/**
 * MOCK number ranges (simulation rule SIM-2).
 *
 * Document numbers are assigned only when the simulated execution creates the document. The start values
 * are chosen so that the FIRST execution of a mock session yields exactly the document numbers of the
 * golden test case (prompt.md, Anhang C): Service Request 8000000010 · Quotation 8000000030 · Order 8000000031 ·
 * Confirmation 9000000000 · Billing Document Request 10000012 · Billing Document 90000115.
 * Quotation and order share one interval (as in the golden data). Seed documents lie below these values.
 * Real S/4HANA number ranges are customizing; nothing here is an SAP object.
 */
const clock = require('./clock');

const START = Object.freeze({
    CASE: 7, // STC-<year>-000001..000006 are seed test cases
    EXECUTION: 3, // MOCK-<date>-0001 and -0002 are used by the seed executions
    SERVICE_REQUEST: 8000000010,
    QUOTATION_ORDER: 8000000030,
    SERVICE_CONFIRMATION: 9000000000,
    BILLING_DOC_REQUEST: 10000012,
    BILLING_DOCUMENT: 90000115
});

const stateByTenant = new Map();

function state(tenantId = 'tenant-default') {
    if (!stateByTenant.has(tenantId)) {
        stateByTenant.set(tenantId, { ...START });
    }
    return stateByTenant.get(tenantId);
}

/**
 * Draws the next number of an interval.
 *
 * @param {string} tenantId tenant (sap-client) of the mock session
 * @param {string} interval key of START
 * @returns {number} number
 */
function next(tenantId, interval) {
    const s = state(tenantId);
    if (!(interval in s)) {
        throw new Error(`Unknown number range interval ${interval}`);
    }
    const value = s[interval];
    s[interval] = value + 1;
    return value;
}

/** @returns {string} next Case ID, e.g. STC-2026-000007 (≠ SAP document number; brackets all documents of a run) */
function nextCaseId(tenantId) {
    const year = new Date(clock.now()).getUTCFullYear();
    return `STC-${year}-${String(next(tenantId, 'CASE')).padStart(6, '0')}`;
}

/** @returns {string} next external execution ID of the MockExecutionProvider, e.g. MOCK-20260929-0003 */
function nextExecutionId(tenantId) {
    const d = new Date(clock.now());
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return `MOCK-${ymd}-${String(next(tenantId, 'EXECUTION')).padStart(4, '0')}`;
}

/** Resets all intervals of a tenant (tests). */
function reset(tenantId) {
    stateByTenant.delete(tenantId);
}

/**
 * Sets the next numbers of a tenant (seed generator: seed documents lie below the golden start values).
 *
 * @param {string} tenantId tenant
 * @param {object} values interval → next number
 */
function setNext(tenantId, values) {
    Object.assign(state(tenantId), values);
}

module.exports = { START, next, nextCaseId, nextExecutionId, reset, setNext };
