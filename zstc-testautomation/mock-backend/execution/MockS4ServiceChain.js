'use strict';
/**
 * MockS4ServiceChain — MOCK of the S/4HANA Service document chain
 * Service Request → Service Quotation → Service Order → Service Confirmation → Billing Document Request → Billing Document.
 *
 * Documents are kept in an in-memory store (MockS4DocumentStore). Their field names mirror the released OData APIs
 * (A_ServiceRequest, A_ServiceQuotation, A_ServiceOrder, A_ServiceConfirmation, A_BillingDocumentRequest,
 * A_BillingDocument; see docs/phase-1 Anhang B) so that the verification layer reads them the way it will later
 * read the real APIs.
 *
 * Simulation rules (documented, nothing hidden):
 *   SIM-2 number ranges (common/numberRanges.js) · SIM-3 mock price list (common/pricing.js)
 *   SIM-4 simplified lifecycle status per document · SIM-5 Case ID travels as customer reference
 *   SIM-6 spare part P700-SC-999 is "blocked in plant" → goods issue in the confirmation fails (technical error)
 */
const numberRanges = require('../common/numberRanges');
const pricing = require('../common/pricing');
const { BO } = require('../common/codes');

/** Chain plan with the expected lifecycle status per step (ExecutionStep.ExpectedStatus) */
const CHAIN = Object.freeze([
    { sequence: 1, businessObjectType: BO.SERVICE_REQUEST, expectedStatus: 'Completed' },
    { sequence: 2, businessObjectType: BO.SERVICE_QUOTATION, expectedStatus: 'Accepted' },
    { sequence: 3, businessObjectType: BO.SERVICE_ORDER, expectedStatus: 'Completed' },
    { sequence: 4, businessObjectType: BO.SERVICE_CONFIRMATION, expectedStatus: 'Completed' },
    { sequence: 5, businessObjectType: BO.BILLING_DOC_REQUEST, expectedStatus: 'Billed' },
    { sequence: 6, businessObjectType: BO.BILLING_DOCUMENT, expectedStatus: 'Posted' }
]);

/** In-memory "S/4HANA" (per tenant) */
class MockS4DocumentStore {
    constructor() {
        this.documents = new Map();
    }

    save(businessObjectType, documentId, document) {
        this.documents.set(`${businessObjectType}:${documentId}`, document);
    }

    read(businessObjectType, documentId) {
        return this.documents.get(`${businessObjectType}:${documentId}`);
    }
}

class MockS4ServiceChain {
    /**
     * @param {object} options options
     * @param {string} options.tenantId tenant of the mock session
     * @param {MockS4DocumentStore} [options.store] document store
     */
    constructor({ tenantId, store }) {
        this.tenantId = tenantId;
        this.store = store || new MockS4DocumentStore();
    }

    /** Items and net value of the order (SIM-3) */
    items(data) {
        const service = pricing.priceItem(data.ServiceProduct, data.ServiceDuration, data.ServiceDurationUnit);
        const items = [
            {
                ItemNo: '10',
                Product: data.ServiceProduct,
                ServiceDuration: Number(data.ServiceDuration),
                ServiceDurationUnit: data.ServiceDurationUnit,
                Quantity: Number(data.ServiceDuration),
                QuantityUnit: data.ServiceDurationUnit,
                NetAmount: service.netAmount
            }
        ];
        const notes = [];
        if (!service.priced) {
            notes.push(service.note);
        }
        if (data.ServicePart) {
            const part = pricing.priceItem(data.ServicePart, data.ServicePartQuantity, data.ServicePartQuantityUnit);
            items.push({
                ItemNo: '20',
                Product: data.ServicePart,
                Quantity: Number(data.ServicePartQuantity),
                QuantityUnit: data.ServicePartQuantityUnit,
                NetAmount: part.netAmount
            });
            if (!part.priced) {
                notes.push(part.note);
            }
        }
        const net = pricing.round2(items.reduce((sum, item) => sum + item.NetAmount, 0));
        return { items, net, notes };
    }

    /**
     * Executes one step of the chain for a run.
     *
     * @param {object} run run state of MockExecutionProvider (dataset, correlation, documents so far)
     * @param {object} step chain step
     * @returns {{ok:boolean, document?:object, documentId?:string, actualStatus:string, message:string}} step result
     */
    executeStep(run, step) {
        const data = run.dataset.data;
        const caseId = run.correlation.caseId;
        const docs = run.documents;
        const byType = (type) => docs.find((d) => d.businessObjectType === type);
        const { items, net, notes } = this.items(data);
        const currency = data.TransactionCurrency || 'EUR';
        let documentId;
        let document;
        let predecessor;
        switch (step.businessObjectType) {
            case BO.SERVICE_REQUEST: {
                documentId = String(numberRanges.next(this.tenantId, 'SERVICE_REQUEST'));
                document = {
                    ServiceRequest: documentId,
                    ServiceRequestType: data.ServiceRequestType,
                    ServiceRequestDescription: data.ServiceRequestDescription,
                    SoldToParty: data.SoldToParty,
                    ServiceRequestReporter: data.ServiceRequestReporter,
                    ServiceDocumentPriority: data.ServiceDocumentPriority,
                    SalesOrganization: data.SalesOrganization,
                    ServiceOrganization: data.ServiceOrganization,
                    PurchaseOrderByCustomer: caseId,
                    to_ReferenceObject: [
                        {
                            ServiceReferenceEquipment: data.ServiceReferenceEquipment,
                            ServiceRefFunctionalLocation: data.ServiceRefFunctionalLocation,
                            SrvcRefObjIsMainObject: true
                        }
                    ],
                    ServiceRequestIsCompleted: true,
                    LifecycleStatus: 'Completed'
                };
                break;
            }
            case BO.SERVICE_QUOTATION: {
                predecessor = byType(BO.SERVICE_REQUEST);
                documentId = String(numberRanges.next(this.tenantId, 'QUOTATION_ORDER'));
                document = {
                    ServiceQuotation: documentId,
                    SoldToParty: data.SoldToParty,
                    RespyMgmtServiceTeam: data.RespyMgmtServiceTeam,
                    ServiceQtanExtReference: caseId,
                    to_Item: items,
                    ServiceDocNetAmount: net,
                    TransactionCurrency: currency,
                    ServiceQuotationIsReleased: true,
                    ServiceQuotationIsAccepted: true,
                    LifecycleStatus: 'Accepted'
                };
                break;
            }
            case BO.SERVICE_ORDER: {
                predecessor = byType(BO.SERVICE_QUOTATION);
                documentId = String(numberRanges.next(this.tenantId, 'QUOTATION_ORDER'));
                document = {
                    ServiceOrder: documentId,
                    ReferenceServiceRequest: byType(BO.SERVICE_REQUEST)?.documentId,
                    SoldToParty: data.SoldToParty,
                    PurchaseOrderByCustomer: caseId,
                    RespyMgmtServiceTeam: data.RespyMgmtServiceTeam,
                    to_ReferenceObject: [
                        {
                            ServiceReferenceEquipment: data.ServiceReferenceEquipment,
                            ServiceRefFunctionalLocation: data.ServiceRefFunctionalLocation,
                            SrvcRefObjIsMainObject: true
                        }
                    ],
                    to_Item: items,
                    ServiceDocNetAmount: net,
                    TransactionCurrency: currency,
                    ServiceOrderIsReleased: true,
                    ServiceOrderIsCompleted: true,
                    LifecycleStatus: 'Completed'
                };
                // quotation → successor order (A_ServiceQuotation.ServiceQtanSuccessorOrder)
                const quotation = byType(BO.SERVICE_QUOTATION);
                if (quotation) {
                    quotation.document.ServiceQtanSuccessorOrder = documentId;
                }
                break;
            }
            case BO.SERVICE_CONFIRMATION: {
                predecessor = byType(BO.SERVICE_ORDER);
                if (data.ServicePart && pricing.isBlocked(data.ServicePart)) {
                    return {
                        ok: false,
                        actualStatus: 'Error',
                        message: `Goods issue for spare part ${data.ServicePart} failed: material is blocked in plant 1010 (mock rule SIM-6).`
                    };
                }
                documentId = String(numberRanges.next(this.tenantId, 'SERVICE_CONFIRMATION'));
                document = {
                    ServiceConfirmation: documentId,
                    ReferenceServiceOrder: predecessor?.documentId,
                    SoldToParty: data.SoldToParty,
                    PurchaseOrderByCustomer: caseId,
                    to_Item: items.map((item) =>
                        item.ServiceDuration !== undefined
                            ? { ...item, ActualServiceDuration: item.ServiceDuration, ActualServiceDurationUnit: item.ServiceDurationUnit }
                            : item
                    ),
                    ServiceConfirmationIsCompleted: true,
                    ServiceConfirmationIsFinal: true,
                    LifecycleStatus: 'Completed'
                };
                break;
            }
            case BO.BILLING_DOC_REQUEST: {
                // Time & material: billing from the confirmation; fixed price: billing from the order (⚠ to verify, F-7)
                predecessor = run.dataset.processProfile === 'FS_FIXPRICE' ? byType(BO.SERVICE_ORDER) : byType(BO.SERVICE_CONFIRMATION);
                documentId = String(numberRanges.next(this.tenantId, 'BILLING_DOC_REQUEST'));
                document = {
                    BillingDocumentRequest: documentId,
                    ReferenceDocument: predecessor?.documentId,
                    ReferenceDocSDDocCategory: predecessor?.businessObjectType,
                    SoldToParty: data.SoldToParty,
                    PurchaseOrderByCustomer: caseId,
                    to_Item: items.map((item) => ({ Material: item.Product, BillingQuantity: item.Quantity, BillingQuantityUnit: item.QuantityUnit, NetAmount: item.NetAmount })),
                    TotalNetAmount: net,
                    TransactionCurrency: currency,
                    OverallBillingDocReqStatus: 'C',
                    LifecycleStatus: 'Billed'
                };
                break;
            }
            case BO.BILLING_DOCUMENT: {
                predecessor = byType(BO.BILLING_DOC_REQUEST);
                documentId = String(numberRanges.next(this.tenantId, 'BILLING_DOCUMENT'));
                document = {
                    BillingDocument: documentId,
                    SoldToParty: data.SoldToParty,
                    PurchaseOrderByCustomer: caseId,
                    to_Item: items.map((item) => ({ Material: item.Product, BillingQuantity: item.Quantity, BillingQuantityUnit: item.QuantityUnit, NetAmount: item.NetAmount, ReferenceSDDocument: predecessor?.documentId })),
                    TotalNetAmount: net,
                    TransactionCurrency: currency,
                    OverallBillingStatus: 'C',
                    AccountingPostingStatus: 'C',
                    BillingDocumentIsCancelled: false,
                    LifecycleStatus: 'Posted'
                };
                break;
            }
            default:
                throw new Error(`Unknown chain step ${step.businessObjectType}`);
        }
        this.store.save(step.businessObjectType, documentId, document);
        const entry = {
            businessObjectType: step.businessObjectType,
            documentId,
            predecessorId: predecessor?.documentId || '',
            predecessorType: predecessor?.businessObjectType || '',
            lifecycleStatus: document.LifecycleStatus,
            netAmount: document.TotalNetAmount ?? document.ServiceDocNetAmount ?? null,
            currency,
            document
        };
        if (predecessor) {
            predecessor.successorId = documentId;
        }
        docs.push(entry);
        const pricingNote = notes.length && (step.businessObjectType === BO.SERVICE_QUOTATION || step.businessObjectType === BO.SERVICE_ORDER) ? ` Pricing incomplete: ${notes.join('; ')}.` : '';
        return { ok: true, document, documentId, actualStatus: document.LifecycleStatus, message: `${documentId} created.${pricingNote}` };
    }
}

module.exports = { CHAIN, MockS4ServiceChain, MockS4DocumentStore };
