'use strict';
/**
 * VerificationService — REAL verification logic, applied to the (mock) documents.
 *
 * Reads the created documents through a document reader (mock: MockS4DocumentStore; real: released OData APIs)
 * and compares Expected (approved test data) with Actual (document fields) per field:
 * SoldToParty, Equipment, FunctionalLocation, ServiceProduct, Quantity, Unit, ServiceDuration, ServicePart,
 * Status, NetValue, DocumentFlow.
 *
 * Final result (fixed precedence):
 *   technical failure → FAILED_TECHNICAL · cancelled / precondition missing → BLOCKED ·
 *   any assertion FAILED → FAILED_FUNCTIONAL · any WARNING → PASSED_WITH_WARNING · otherwise PASSED
 */
const { ASSERTION, RESULT, EXECUTION, BO, criticalityOf } = require('../common/codes');
const pricing = require('../common/pricing');

const fmtAmount = (value, currency) =>
    value === null || value === undefined || Number.isNaN(Number(value))
        ? ''
        : `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim();
const fmtQty = (qty, unit) => (qty === null || qty === undefined || qty === '' ? '' : `${Number(qty)} ${unit || ''}`.trim());
const norm = (value) => (value === null || value === undefined ? '' : String(value).trim());

class AssertionBuilder {
    constructor() {
        this.assertions = [];
    }

    add(businessObjectType, field, expected, actual, { tolerance = '', result, message } = {}) {
        const res = result || (norm(expected) === norm(actual) ? ASSERTION.PASSED : ASSERTION.FAILED);
        this.assertions.push({
            Sequence: this.assertions.length + 1,
            BusinessObjectType: businessObjectType,
            Field: field,
            ExpectedValue: norm(expected),
            ActualValue: norm(actual),
            Tolerance: tolerance,
            Result: res,
            Criticality: criticalityOf(res),
            Message: message || (res === ASSERTION.PASSED ? 'Expected and actual value match.' : res === ASSERTION.FAILED ? 'Actual value differs from the expected value.' : '')
        });
    }

    notEvaluated(businessObjectType, field, expected, reason) {
        this.add(businessObjectType, field, expected, '', { result: ASSERTION.NOT_EVALUATED, message: reason });
    }
}

/**
 * @param {object} input input
 * @param {object} input.data approved TestCaseData
 * @param {object[]} input.documents documents returned by the provider ({businessObjectType, documentId, predecessorId, ...})
 * @param {Function} input.readDocument (businessObjectType, documentId) → document fields (document reader)
 * @param {object[]} input.steps provider steps incl. expectedStatus / actualStatus / status
 * @param {string} input.executionStatus FINISHED | FAILED | CANCELLED
 * @param {string} input.technicalResult OK | ERROR
 * @returns {{assertions: object[], finalResult: string}} assertions and final result
 */
function verify({ data, documents, readDocument, steps, executionStatus, technicalResult }) {
    const b = new AssertionBuilder();
    const doc = (type) => {
        const ref = documents.find((d) => d.businessObjectType === type);
        return ref ? { ref, fields: readDocument(type, ref.documentId) || {} } : undefined;
    };
    const sr = doc(BO.SERVICE_REQUEST);
    const order = doc(BO.SERVICE_ORDER);
    const confirmation = doc(BO.SERVICE_CONFIRMATION);
    const billing = doc(BO.BILLING_DOCUMENT);
    const missing = 'Document was not created; assertion could not be evaluated.';

    // Service request: customer and reference object
    if (sr) {
        const ref = (sr.fields.to_ReferenceObject || [])[0] || {};
        b.add(BO.SERVICE_REQUEST, 'SoldToParty', data.SoldToParty, sr.fields.SoldToParty);
        b.add(BO.SERVICE_REQUEST, 'FunctionalLocation', data.ServiceRefFunctionalLocation, ref.ServiceRefFunctionalLocation);
        b.add(BO.SERVICE_REQUEST, 'Equipment', data.ServiceReferenceEquipment, ref.ServiceReferenceEquipment);
    } else {
        b.notEvaluated(BO.SERVICE_REQUEST, 'SoldToParty', data.SoldToParty, missing);
    }

    // Service order: items
    if (order) {
        const items = order.fields.to_Item || [];
        const serviceItem = items.find((i) => i.ServiceDuration !== undefined) || {};
        const partItem = items.find((i) => i.ServiceDuration === undefined) || {};
        b.add(BO.SERVICE_ORDER, 'SoldToParty', data.SoldToParty, order.fields.SoldToParty);
        b.add(BO.SERVICE_ORDER, 'ServiceProduct', data.ServiceProduct, serviceItem.Product);
        b.add(BO.SERVICE_ORDER, 'ServiceDuration', fmtQty(data.ServiceDuration, data.ServiceDurationUnit), fmtQty(serviceItem.ServiceDuration, serviceItem.ServiceDurationUnit));
        if (data.ServicePart) {
            b.add(BO.SERVICE_ORDER, 'ServicePart', data.ServicePart, partItem.Product);
            b.add(BO.SERVICE_ORDER, 'Quantity', norm(Number(data.ServicePartQuantity)), norm(partItem.Quantity));
            b.add(BO.SERVICE_ORDER, 'Unit', data.ServicePartQuantityUnit, partItem.QuantityUnit);
        }
    } else {
        b.notEvaluated(BO.SERVICE_ORDER, 'ServiceProduct', data.ServiceProduct, missing);
    }

    // Service confirmation: actual duration
    if (confirmation) {
        const confirmed = (confirmation.fields.to_Item || []).find((i) => i.ActualServiceDuration !== undefined) || {};
        b.add(
            BO.SERVICE_CONFIRMATION,
            'ServiceDuration',
            fmtQty(data.ServiceDuration, data.ServiceDurationUnit),
            fmtQty(confirmed.ActualServiceDuration, confirmed.ActualServiceDurationUnit)
        );
    } else {
        b.notEvaluated(BO.SERVICE_CONFIRMATION, 'ServiceDuration', fmtQty(data.ServiceDuration, data.ServiceDurationUnit), missing);
    }

    // Billing document: customer and net value (tolerance)
    if (billing) {
        b.add(BO.BILLING_DOCUMENT, 'SoldToParty', data.SoldToParty, billing.fields.SoldToParty);
        const expected = Number(data.ExpectedNetAmount);
        const actual = Number(billing.fields.TotalNetAmount);
        const tolerance = Math.abs(Number(data.NetAmountTolerance) || 0);
        const currency = data.TransactionCurrency || billing.fields.TransactionCurrency;
        const deviation = pricing.round2(Math.abs(actual - expected));
        let result = ASSERTION.PASSED;
        let message = 'Net value matches the expectation.';
        if (data.ExpectedNetAmount === null || data.ExpectedNetAmount === undefined || data.ExpectedNetAmount === '') {
            result = ASSERTION.NOT_EVALUATED;
            message = 'No expected net value maintained.';
        } else if (deviation > tolerance) {
            result = ASSERTION.FAILED;
            message = `Deviation ${fmtAmount(deviation, currency)} exceeds the tolerance ${fmtAmount(tolerance, currency)}.`;
        } else if (deviation > 0) {
            result = ASSERTION.WARNING;
            message = `Deviation ${fmtAmount(deviation, currency)} is within the tolerance ${fmtAmount(tolerance, currency)}.`;
        }
        b.add(BO.BILLING_DOCUMENT, 'NetValue', fmtAmount(expected, currency), fmtAmount(actual, billing.fields.TransactionCurrency), {
            tolerance: fmtAmount(tolerance, currency),
            result,
            message
        });
    } else {
        b.notEvaluated(BO.BILLING_DOCUMENT, 'NetValue', fmtAmount(data.ExpectedNetAmount, data.TransactionCurrency), missing);
    }

    // Status per document
    for (const step of steps) {
        if (step.status === 'DONE' || step.status === 'FAILED') {
            b.add(step.businessObjectType, 'Status', step.expectedStatus, step.actualStatus);
        } else {
            b.notEvaluated(step.businessObjectType, 'Status', step.expectedStatus, `Step ${step.status.toLowerCase()}.`);
        }
    }

    // Document flow: complete chain with consistent predecessors
    const expectedFlow = 'SR → QT → SO → SC → BDR → BD';
    const chainOk =
        documents.length === 6 &&
        documents.every((d, i) => (i === 0 ? true : d.predecessorId === documents[i - 1].documentId || (d.businessObjectType === BO.BILLING_DOC_REQUEST && d.predecessorId)));
    const actualFlow = documents.map((d) => d.documentId).join(' → ');
    b.add(BO.BILLING_DOCUMENT, 'DocumentFlow', expectedFlow, actualFlow, {
        result: documents.length === 0 ? ASSERTION.NOT_EVALUATED : chainOk ? ASSERTION.PASSED : ASSERTION.FAILED,
        message: chainOk ? 'Document flow is complete and consistent.' : `Document flow incomplete: ${documents.length} of 6 documents.`
    });

    let finalResult;
    if (technicalResult === 'ERROR' || executionStatus === EXECUTION.FAILED) {
        finalResult = RESULT.FAILED_TECHNICAL;
    } else if (executionStatus === EXECUTION.CANCELLED) {
        finalResult = RESULT.BLOCKED;
    } else if (b.assertions.some((a) => a.Result === ASSERTION.FAILED)) {
        finalResult = RESULT.FAILED_FUNCTIONAL;
    } else if (b.assertions.some((a) => a.Result === ASSERTION.WARNING)) {
        finalResult = RESULT.PASSED_WITH_WARNING;
    } else {
        finalResult = RESULT.PASSED;
    }
    return { assertions: b.assertions, finalResult };
}

module.exports = { verify, fmtAmount };
