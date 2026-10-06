'use strict';
/**
 * processCatalog — pure functions on the process model (process steps and variants of a business process).
 *
 * A process variant is a path through the process flow ("Weg"): every process step lists the variants it belongs to
 * (ProcessStep.Variants, comma-separated) and the sequence orders the path. A test case runs a section of the path:
 * from its start object ("Start from", default: where its process team enters the path) up to its end object
 * ("Run up to"). From the section the backend derives
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

/** The FI step only reads the posting of a billing document created in the same run: no start object */
const NO_START = new Set([BO.ACCOUNTING_DOCUMENT]);

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

/**
 * Section of a path between start object and end object. Contract determination steps before the start stay in the
 * section: they create no document, they check the precondition and provide the contract reference.
 *
 * @param {object[]} path design path of the variant
 * @param {string} [startObject] business object type the run starts with
 * @param {string} [endObject] business object type the run ends with
 * @returns {{path: object[], endObjectInPath: boolean, startObjectInPath: boolean}} section
 */
function section(path, startObject, endObject) {
    const { path: upToEnd, endObjectInPath } = truncate(path, endObject);
    if (!startObject) {
        return { path: upToEnd, endObjectInPath, startObjectInPath: true };
    }
    const first = upToEnd.findIndex((step) => step.BusinessObjectType === startObject);
    if (first === -1) {
        return { path: upToEnd, endObjectInPath, startObjectInPath: false };
    }
    const preconditions = upToEnd.slice(0, first).filter((step) => step.BusinessObjectType === BO.SERVICE_CONTRACT);
    return { path: [...preconditions, ...upToEnd.slice(first)], endObjectInPath, startObjectInPath: true };
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
 * Objects a run of this variant can start with: the business objects of the automated plan up to the end object
 * (without the FI check, which needs the billing document of the same run).
 *
 * @param {object[]} steps process steps
 * @param {string} variant variant code
 * @param {string} [endObject] end object
 * @returns {string[]} business object types
 */
function possibleStartObjects(steps, variant, endObject) {
    const types = [];
    for (const step of executionPlan(steps, variant, endObject)) {
        if (!NO_START.has(step.businessObjectType) && !types.includes(step.businessObjectType)) {
            types.push(step.businessObjectType);
        }
    }
    return types;
}

/**
 * Default start object for a process team: the first automated step of the path the team is responsible for
 * ("start of the process team"), e.g. the quotation for the quotation team; without such a step the start of the path.
 *
 * @param {object[]} steps process steps
 * @param {string} variant variant code
 * @param {string} team process team of the test case
 * @param {string} [endObject] end object
 * @returns {string|undefined} business object type
 */
function defaultStartObject(steps, variant, team, endObject) {
    const possible = possibleStartObjects(steps, variant, endObject);
    const own = executionPlan(steps, variant, endObject).find((step) => step.responsibleTeam === team && possible.includes(step.businessObjectType));
    return own ? own.businessObjectType : possible[0];
}

/**
 * Document a run needs from a predecessor when it starts with the given object. Service request, quotation, order and
 * the contract can be created (determined) without a predecessor; a confirmation needs the order, a billing document
 * request the confirmation (time and material), the order (fixed price) or — for the billing plan — only the contract,
 * a billing document the billing document request.
 *
 * @param {object[]} steps process steps
 * @param {string} variant variant code
 * @param {string} startObject start object
 * @param {object} [options] options
 * @param {boolean} [options.fixedPrice] billing from the order (process profile with fixed price)
 * @returns {string} business object type of the predecessor document, '' when none is needed
 */
function requiredPredecessor(steps, variant, startObject, { fixedPrice = false } = {}) {
    switch (startObject) {
        case BO.SERVICE_CONFIRMATION:
            return BO.SERVICE_ORDER;
        case BO.BILLING_DOC_REQUEST: {
            if (!documentTypes(variantPath(steps, variant)).includes(BO.SERVICE_ORDER)) {
                return '';
            }
            return fixedPrice ? BO.SERVICE_ORDER : BO.SERVICE_CONFIRMATION;
        }
        case BO.BILLING_DOCUMENT:
            return BO.BILLING_DOC_REQUEST;
        default:
            return '';
    }
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
 * @param {string} [startObject] start with this business object (section of the path)
 * @returns {object[]} plan steps {sequence, businessObjectType, expectedStatus, processStepID, stepName, responsibleTeam}
 */
function executionPlan(steps, variant, endObject, startObject) {
    const { path } = section(variantPath(steps, variant), startObject, endObject);
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
 * Test steps (design) of a test case: one step per process step of its section of the path (start object up to end
 * object), with the action and expected result templates of the process step.
 *
 * @param {object[]} steps ProcessStep rows of the process
 * @param {string} variant variant code
 * @param {string} [endObject] end object
 * @param {string} [startObject] start object
 * @returns {object[]} test step drafts
 */
function designSteps(steps, variant, endObject, startObject) {
    const { path } = section(variantPath(steps, variant), startObject, endObject);
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
    NO_START,
    AUTOMATION,
    PILOT,
    variantsOf,
    variantPath,
    truncate,
    section,
    documentTypes,
    documentPath,
    stepPath,
    possibleEndObjects,
    defaultEndObject,
    possibleStartObjects,
    defaultStartObject,
    requiredPredecessor,
    handovers,
    executionPlan,
    designSteps,
    contentHash,
    stableStringify
};
