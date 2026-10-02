/**
 * VerificationService — REAL verification logic, applied to the (mock) documents.
 *
 * Reads the created documents through a document reader (mock: MockS4DocumentStore; real: released OData APIs)
 * and compares Expected (approved test data) with Actual (document fields) per field — only for the business objects
 * of the executed plan (process variant up to the end object):
 * SoldToParty, Equipment, FunctionalLocation, ServiceContract, QuotationDecision, ServiceProduct, Quantity, Unit,
 * ServiceDuration, ServicePart, Status, NetValue, AccountingDocument, DocumentFlow.
 * Every assertion carries the process step of the document, so results can be traced to the process step.
 *
 * Final result (fixed precedence):
 *   precondition missing (technical result BLOCKED) or cancelled → BLOCKED · technical failure → FAILED_TECHNICAL ·
 *   any assertion FAILED → FAILED_FUNCTIONAL · any WARNING → PASSED_WITH_WARNING · otherwise PASSED
 */
const { ASSERTION, RESULT, EXECUTION, BO, criticalityOf } = require('../common/codes');
const pricing = require('../common/pricing');
const { DOCUMENT_ABBREVIATION } = require('../process/processCatalog');

const fmtAmount = (value, currency) =>
    value === null || value === undefined || Number.isNaN(Number(value))
        ? ''
        : `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim();
const fmtQty = (qty, unit) => (qty === null || qty === undefined || qty === '' ? '' : `${Number(qty)} ${unit || ''}`.trim());
const norm = (value) => (value === null || value === undefined ? '' : String(value).trim());

class AssertionBuilder {
    constructor(stepOf = () => ({})) {
        this.assertions = [];
        this.stepOf = stepOf;
    }

    add(businessObjectType, field, expected, actual, { tolerance = '', result, message, step } = {}) {
        const res = result || (norm(expected) === norm(actual) ? ASSERTION.PASSED : ASSERTION.FAILED);
        const processStep = step || this.stepOf(businessObjectType) || {};
        this.assertions.push({
            Sequence: this.assertions.length + 1,
            BusinessObjectType: businessObjectType,
            ProcessStepID: processStep.processStepID || '',
            StepName: processStep.stepName || '',
            Field: field,
            ExpectedValue: norm(expected),
            ActualValue: norm(actual),
            Tolerance: tolerance,
            Result: res,
            Criticality: criticalityOf(res),
            Message: message || (res === ASSERTION.PASSED ? 'Expected and actual value match.' : res === ASSERTION.FAILED ? 'Actual value differs from the expected value.' : '')
        });
    }

    notEvaluated(businessObjectType, field, expected, reason, step) {
        this.add(businessObjectType, field, expected, '', { result: ASSERTION.NOT_EVALUATED, message: reason, step });
    }
}

/**
 * @param {object} input input
 * @param {object} input.data approved TestCaseData
 * @param {object[]} input.documents documents returned by the provider ({businessObjectType, documentId, predecessorId, ...})
 * @param {Function} input.readDocument (businessObjectType, documentId) → document fields (document reader)
 * @param {object[]} input.steps provider steps (= executed plan) incl. expectedStatus / actualStatus / status / processStepID
 * @param {string} input.executionStatus FINISHED | FAILED | CANCELLED
 * @param {string} input.technicalResult OK | ERROR | BLOCKED
 * @returns {{assertions: object[], finalResult: string}} assertions and final result
 */
function verify({ data, documents, readDocument, steps, executionStatus, technicalResult }) {
    const planned = (type) => steps.some((step) => step.businessObjectType === type);
    // the process step that created a document is the first plan step of its business object
    const stepOf = (type) => steps.find((step) => step.businessObjectType === type);
    const b = new AssertionBuilder(stepOf);
    const doc = (type) => {
        const ref = documents.find((d) => d.businessObjectType === type);
        return ref ? { ref, fields: readDocument(type, ref.documentId) || {} } : undefined;
    };
    const contract = doc(BO.SERVICE_CONTRACT);
    const sr = doc(BO.SERVICE_REQUEST);
    const quotation = doc(BO.SERVICE_QUOTATION);
    const order = doc(BO.SERVICE_ORDER);
    const confirmation = doc(BO.SERVICE_CONFIRMATION);
    const request = doc(BO.BILLING_DOC_REQUEST);
    const billing = doc(BO.BILLING_DOCUMENT);
    const accounting = doc(BO.ACCOUNTING_DOCUMENT);
    const missing = 'Document was not created; assertion could not be evaluated.';

    // Service contract: contract determination (variant "service from a contract")
    if (planned(BO.SERVICE_CONTRACT)) {
        if (contract) {
            b.add(BO.SERVICE_CONTRACT, 'ServiceContract', data.ServiceContract, contract.ref.documentId);
        } else {
            b.notEvaluated(BO.SERVICE_CONTRACT, 'ServiceContract', data.ServiceContract, 'No valid service contract was determined (precondition of the variant).');
        }
    }

    // Service request: customer and reference object
    if (planned(BO.SERVICE_REQUEST)) {
        if (sr) {
            const ref = (sr.fields.to_ReferenceObject || [])[0] || {};
            b.add(BO.SERVICE_REQUEST, 'SoldToParty', data.SoldToParty, sr.fields.SoldToParty);
            b.add(BO.SERVICE_REQUEST, 'FunctionalLocation', data.ServiceRefFunctionalLocation, ref.ServiceRefFunctionalLocation);
            b.add(BO.SERVICE_REQUEST, 'Equipment', data.ServiceReferenceEquipment, ref.ServiceReferenceEquipment);
        } else {
            b.notEvaluated(BO.SERVICE_REQUEST, 'SoldToParty', data.SoldToParty, missing);
        }
    }

    // Service quotation: customer decision of the variant (accepted → follow-up order, rejected → none)
    const decision = steps.filter((step) => step.businessObjectType === BO.SERVICE_QUOTATION).pop();
    if (decision && decision.expectedStatus === 'Rejected') {
        if (quotation) {
            b.add(BO.SERVICE_QUOTATION, 'QuotationDecision', 'Rejected', quotation.fields.LifecycleStatus, { step: decision });
            b.add(BO.SERVICE_QUOTATION, 'SuccessorOrder', '', quotation.fields.ServiceQtanSuccessorOrder || '', {
                step: decision,
                message: quotation.fields.ServiceQtanSuccessorOrder ? 'A rejected quotation must not have a follow-up order.' : 'No follow-up order for the rejected quotation.'
            });
        } else {
            b.notEvaluated(BO.SERVICE_QUOTATION, 'QuotationDecision', 'Rejected', missing, decision);
        }
    }

    // Service order: items (and contract reference)
    if (planned(BO.SERVICE_ORDER)) {
        if (order) {
            const items = order.fields.to_Item || [];
            const serviceItem = items.find((i) => i.ServiceDuration !== undefined) || {};
            const partItem = items.find((i) => i.ServiceDuration === undefined) || {};
            b.add(BO.SERVICE_ORDER, 'SoldToParty', data.SoldToParty, order.fields.SoldToParty);
            if (planned(BO.SERVICE_CONTRACT)) {
                b.add(BO.SERVICE_ORDER, 'ReferenceServiceContract', data.ServiceContract, order.fields.ReferenceServiceContract);
            }
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
    }

    // Service confirmation: actual duration
    if (planned(BO.SERVICE_CONFIRMATION)) {
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
    }

    // Billing document: customer
    if (planned(BO.BILLING_DOCUMENT)) {
        if (billing) {
            b.add(BO.BILLING_DOCUMENT, 'SoldToParty', data.SoldToParty, billing.fields.SoldToParty);
        }
    }

    // Net value (tolerance) on the last priced document of the plan: billing document, request, order or quotation
    const pricedType = [BO.BILLING_DOCUMENT, BO.BILLING_DOC_REQUEST, BO.SERVICE_ORDER, BO.SERVICE_QUOTATION].find(planned);
    const rejected = decision && decision.expectedStatus === 'Rejected';
    if (pricedType && !rejected) {
        const priced = doc(pricedType);
        const actualAmount = priced ? Number(priced.fields.TotalNetAmount ?? priced.fields.ServiceDocNetAmount) : undefined;
        const currency = data.TransactionCurrency || priced?.fields.TransactionCurrency;
        if (!priced) {
            b.notEvaluated(pricedType, 'NetValue', fmtAmount(data.ExpectedNetAmount, data.TransactionCurrency), missing);
        } else {
            const expected = Number(data.ExpectedNetAmount);
            const tolerance = Math.abs(Number(data.NetAmountTolerance) || 0);
            const deviation = pricing.round2(Math.abs(actualAmount - expected));
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
            b.add(pricedType, 'NetValue', fmtAmount(expected, currency), fmtAmount(actualAmount, priced.fields.TransactionCurrency), {
                tolerance: fmtAmount(tolerance, currency),
                result,
                message
            });
        }
    }

    // Accounting document: the billing document was posted to FI
    if (planned(BO.ACCOUNTING_DOCUMENT)) {
        if (accounting) {
            b.add(BO.ACCOUNTING_DOCUMENT, 'AccountingDocument', billing?.fields.AccountingDocument || 'posted', accounting.ref.documentId, {
                message: `Billing document ${billing?.ref.documentId || ''} posted to accounting (company code ${accounting.fields.CompanyCode}, fiscal year ${accounting.fields.FiscalYear}).`
            });
        } else {
            b.notEvaluated(BO.ACCOUNTING_DOCUMENT, 'AccountingDocument', 'posted', missing);
        }
    }

    // Status per plan step
    for (const step of steps) {
        if (step.status === 'DONE' || step.status === 'FAILED') {
            b.add(step.businessObjectType, 'Status', step.expectedStatus, step.actualStatus, { step });
        } else {
            b.notEvaluated(step.businessObjectType, 'Status', step.expectedStatus, `Step ${step.status.toLowerCase()}.`, step);
        }
    }

    // Document flow: all documents of the plan with consistent predecessors
    const expectedTypes = [];
    for (const step of steps) {
        if (!expectedTypes.includes(step.businessObjectType)) {
            expectedTypes.push(step.businessObjectType);
        }
    }
    const expectedFlow = expectedTypes.map((type) => DOCUMENT_ABBREVIATION[type] || type).join(' → ');
    const chainOk =
        documents.length === expectedTypes.length &&
        documents.every((d, i) => i === 0 || d.predecessorId === documents[i - 1].documentId || (d.businessObjectType === BO.BILLING_DOC_REQUEST && d.predecessorId));
    const actualFlow = documents.map((d) => d.documentId).join(' → ');
    const lastStep = steps[steps.length - 1];
    b.add(lastStep ? lastStep.businessObjectType : BO.BILLING_DOCUMENT, 'DocumentFlow', expectedFlow, actualFlow, {
        result: documents.length === 0 ? ASSERTION.NOT_EVALUATED : chainOk ? ASSERTION.PASSED : ASSERTION.FAILED,
        message: chainOk ? 'Document flow is complete and consistent.' : `Document flow incomplete: ${documents.length} of ${expectedTypes.length} documents.`,
        step: lastStep
    });

    let finalResult;
    if (technicalResult === 'BLOCKED' || executionStatus === EXECUTION.CANCELLED) {
        finalResult = RESULT.BLOCKED;
    } else if (technicalResult === 'ERROR' || executionStatus === EXECUTION.FAILED) {
        finalResult = RESULT.FAILED_TECHNICAL;
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
