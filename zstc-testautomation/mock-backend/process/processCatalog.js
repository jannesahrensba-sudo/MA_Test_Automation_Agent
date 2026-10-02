'use strict';
/**
 * processCatalog — pure functions on the process model (process steps and variants of a business process).
 *
 * A process variant is a path through the process flow ("Weg"): every process step lists the variants it belongs to
 * (ProcessStep.Variants, comma-separated) and the sequence orders the path. From the path the backend derives
 *   - the test steps of a test case (design time, like the activities/actions of a test case in SAP Cloud ALM),
 *   - the execution plan of the automated run (only steps with a business object, up to the selected end object),
 *   - handovers between process teams and the expected document chain.
 *
 * No mock server APIs: unit-testable and used unchanged by the browser-hosted mock service.
 */
const { BO } = require('../common/codes');

/** Order of the documents in the service-to-cash chain (used for "run up to" and the document path) */
const DOCUMENT_ORDER = [
    BO.SERVICE_CONTRACT,
    BO.SERVICE_REQUEST,
    BO.SERVICE_QUOTATION,
    BO.SERVICE_ORDER,
    BO.SERVICE_CONFIRMATION,
    BO.BILLING_DOC_REQUEST,
    BO.BILLING_DOCUMENT,
    BO.ACCOUNTING_DOCUMENT
];

const DOCUMENT_ABBREVIATION = {
    SERVICE_CONTRACT: 'CT',
    SERVICE_REQUEST: 'SR',
    SERVICE_QUOTATION: 'QT',
    SERVICE_ORDER: 'SO',
    SERVICE_CONFIRMATION: 'SC',
    BILLING_DOC_REQUEST: 'BDR',
    BILLING_DOCUMENT: 'BD',
    ACCOUNTING_DOCUMENT: 'FI'
};

/** Default end object of a test case when nothing is selected: the billing document (golden path) */
const DEFAULT_END_OBJECT = BO.BILLING_DOCUMENT;

const AUTOMATION = Object.freeze({ AUTOMATED: 'AUTOMATED', DECISION: 'DECISION', MANUAL: 'MANUAL', PLANNED: 'PLANNED' });
const PILOT = 'PILOT';

function variantsOf(step) {
    return String(step.Variants || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
}

function bySequence(a, b) {
    return (Number(a.Sequence) || 0) - (Number(b.Sequence) || 0) || String(a.StepID).localeCompare(String(b.StepID));
}

/**
 * All steps of a variant in process order (design path, incl. decisions and manual steps).
 *
 * @param {object[]} steps ProcessStep rows of the process
 * @param {string} variant variant code
 * @returns {object[]} steps of the path
 */
function variantPath(steps, variant) {
    return steps.filter((step) => variantsOf(step).includes(variant)).sort(bySequence);
}

/**
 * Cuts a path after the last step of the end object (e.g. "run up to Service Order"). When the end object is not part
 * of the path, the full path is returned and `endObjectInPath` is false.
 *
 * @param {object[]} path design path
 * @param {string} [endObject] business object type
 * @returns {{path: object[], endObjectInPath: boolean}} truncated path
 */
function truncate(path, endObject) {
    if (!endObject) {
        return { path, endObjectInPath: true };
    }
    let last = -1;
    path.forEach((step, index) => {
        if (step.BusinessObjectType === endObject) {
            last = index;
        }
    });
    if (last === -1) {
        return { path, endObjectInPath: false };
    }
    return { path: path.slice(0, last + 1), endObjectInPath: true };
}

/** Business objects with documents along a path (unique, in path order) */
function documentTypes(path) {
    const types = [];
    for (const step of path) {
        if (step.BusinessObjectType && !types.includes(step.BusinessObjectType)) {
            types.push(step.BusinessObjectType);
        }
    }
    return types;
}

/** "SR → QT → SO → SC → BDR → BD" */
function documentPath(path) {
    return documentTypes(path)
        .map((type) => DOCUMENT_ABBREVIATION[type] || type)
        .join(' → ');
}

/** "REP-010 → REP-020 → …" */
function stepPath(path) {
    return path.map((step) => step.StepID).join(' → ');
}

/** End objects a test case of this variant can run up to (business objects of the path) */
function possibleEndObjects(steps, variant) {
    return documentTypes(variantPath(steps, variant));
}

/**
 * Default end object of a variant: the billing document when the path has one, otherwise the last document.
 *
 * @param {object[]} steps process steps
 * @param {string} variant variant code
 * @returns {string|undefined} business object type
 */
function defaultEndObject(steps, variant) {
    const types = possibleEndObjects(steps, variant);
    if (types.includes(DEFAULT_END_OBJECT)) {
        return DEFAULT_END_OBJECT;
    }
    return types[types.length - 1];
}

/**
 * Handover flags along a path: a step is a handover when its responsible team differs from the team of the previous step
 * (an open team assignment counts as a different team).
 *
 * @param {object[]} path design path
 * @returns {boolean[]} flag per step
 */
function handovers(path) {
    return path.map((step, index) => index > 0 && (step.ResponsibleTeam || '') !== (path[index - 1].ResponsibleTeam || ''));
}

/**
 * Execution plan of an automated run: steps with a business object and automation AUTOMATED, in path order.
 *
 * @param {object[]} steps ProcessStep rows of the process
 * @param {string} variant variant code
 * @param {string} [endObject] run up to this business object
 * @returns {object[]} plan steps {sequence, businessObjectType, expectedStatus, processStepID, stepName, responsibleTeam}
 */
function executionPlan(steps, variant, endObject) {
    const { path } = truncate(variantPath(steps, variant), endObject);
    return path
        .filter((step) => step.BusinessObjectType && step.Automation === AUTOMATION.AUTOMATED && step.PilotScope === PILOT)
        .map((step, index) => ({
            sequence: index + 1,
            businessObjectType: step.BusinessObjectType,
            expectedStatus: step.ExpectedStatus || '',
            processStepID: step.StepID,
            stepName: step.StepName,
            responsibleTeam: step.ResponsibleTeam || ''
        }));
}

/**
 * Test steps (design) of a test case: one step per process step of the path up to the end object, with the action
 * and expected result templates of the process step.
 *
 * @param {object[]} steps ProcessStep rows of the process
 * @param {string} variant variant code
 * @param {string} [endObject] end object
 * @returns {object[]} test step drafts
 */
function designSteps(steps, variant, endObject) {
    const { path } = truncate(variantPath(steps, variant), endObject);
    const flags = handovers(path);
    return path.map((step, index) => ({
        StepNo: (index + 1) * 10,
        ProcessID: step.ProcessID,
        ProcessStepID: step.StepID,
        StepName: step.StepName,
        BusinessObjectType: step.BusinessObjectType || '',
        Action: step.TestAction || step.StepName,
        ExpectedResult: step.TestExpectedResult || (step.ExpectedStatus ? `Status ${step.ExpectedStatus}` : ''),
        ResponsibleTeam: step.ResponsibleTeam || '',
        TeamAssignment: step.TeamAssignment || (step.ResponsibleTeam ? 'ASSIGNED' : 'OPEN'),
        IsHandover: flags[index],
        Automation: step.Automation || AUTOMATION.MANUAL
    }));
}

/**
 * Stable content hash (FNV-1a, 32 bit, hex) of a plain value — used to detect changes between versions.
 *
 * @param {*} value JSON-serializable value
 * @returns {string} hash
 */
function contentHash(value) {
    const text = stableStringify(value);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

module.exports = {
    DOCUMENT_ORDER,
    DOCUMENT_ABBREVIATION,
    DEFAULT_END_OBJECT,
    AUTOMATION,
    PILOT,
    variantsOf,
    variantPath,
    truncate,
    documentTypes,
    documentPath,
    stepPath,
    possibleEndObjects,
    defaultEndObject,
    handovers,
    executionPlan,
    designSteps,
    contentHash,
    stableStringify
};
