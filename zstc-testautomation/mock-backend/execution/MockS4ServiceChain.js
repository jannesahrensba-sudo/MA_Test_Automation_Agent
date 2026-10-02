'use strict';
/**
 * MockS4ServiceChain — MOCK of the S/4HANA Service document chain of the service repair process:
 *   (Service Contract →) Service Request → Service Quotation (accepted | rejected) → Service Order → Service Confirmation
 *   → Billing Document Request → Billing Document → Accounting Document (FI)
 *
 * Which steps run is decided by the execution plan of the test case: the path of its process variant up to the selected
 * end object (mock-backend/process/processCatalog.js). Without a plan the classic chain CHAIN runs (Phase 1 golden path).
 *
 * Documents are kept in an in-memory store (MockS4DocumentStore). Their field names mirror the released OData APIs
 * (A_ServiceRequest, A_ServiceQuotation, A_ServiceOrder, A_ServiceConfirmation, A_ServiceContract,
 * A_BillingDocumentRequest, A_BillingDocument; see docs/phase-1 Anhang B and docs/prozessteams-releases.md) so that the
 * verification layer reads them the way it will later read the real APIs.
 *
 * Simulation rules (documented, nothing hidden):
 *   SIM-2 number ranges (common/numberRanges.js) · SIM-3 mock price list (common/pricing.js)
 *   SIM-4 simplified lifecycle status per document · SIM-5 Case ID travels as customer reference
 *   SIM-6 spare part P700-SC-999 is "blocked in plant" → goods issue in the confirmation fails (technical error)
 *   SIM-9 contract determination: the contract of the test data must be released, valid on the run date and cover the
 *         reference object (functional location or its superior functional location); otherwise the run is BLOCKED
 *         (precondition missing). Contract-specific pricing is NOT simulated (price list as without contract).
 *   SIM-10 the customer decision on the quotation (accepted / rejected) comes from the process variant of the test case
 *   SIM-11 the billing document is transferred to accounting when it is created; the FI step reads that posting
 */
const numberRanges = require('../common/numberRanges');
const pricing = require('../common/pricing');
const clock = require('../common/clock');
const { BO } = require('../common/codes');

/** Classic chain plan (no process variant): expected lifecycle status per step (ExecutionStep.ExpectedStatus) */
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

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

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

    /** Billing plan item of the contract (A_SrvcContrItmBillgReqItem): one settlement period with the contract amount */
    billingPlanItems(contract) {
        const net = pricing.round2(Number(contract.BillingPlanNetAmount) || 0);
        return {
            items: [{ ItemNo: '10', Product: contract.Product, Quantity: 1, QuantityUnit: 'EA', NetAmount: net }],
            net,
            notes: []
        };
    }

    /**
     * SIM-9 contract determination: released, valid on the run date, covers the reference object.
     *
     * @param {object} run run state
     * @returns {{ok: boolean, contract?: object, message: string}} result
     */
    determineContract(run) {
        const data = run.dataset.data;
        const contract = run.dataset.serviceContract;
        const today = isoDate(clock.now());
        if (!contract) {
            return {
                ok: false,
                message: `Contract determination: no service contract${data.ServiceContract ? ` ${data.ServiceContract}` : ''} found for ${data.ServiceReferenceEquipment || data.SoldToParty} (precondition of the variant).`
            };
        }
        if (!contract.ServiceContractIsReleased) {
            return { ok: false, contract, message: `Contract determination: service contract ${contract.ServiceContract} is not released.` };
        }
        if ((contract.ServiceContractStartDate && today < contract.ServiceContractStartDate) || (contract.ServiceContractEndDate && today > contract.ServiceContractEndDate)) {
            return {
                ok: false,
                contract,
                message: `Contract determination: service contract ${contract.ServiceContract} is not valid on ${today} (valid ${contract.ServiceContractStartDate} to ${contract.ServiceContractEndDate}).`
            };
        }
        const covered = run.dataset.referenceLocations || [];
        if (contract.ServiceRefFunctionalLocation && covered.length && !covered.includes(contract.ServiceRefFunctionalLocation)) {
            return {
                ok: false,
                contract,
                message: `Contract determination: service contract ${contract.ServiceContract} does not cover ${data.ServiceReferenceEquipment || data.ServiceRefFunctionalLocation} (covered object ${contract.ServiceRefFunctionalLocation}).`
            };
        }
        return { ok: true, contract, message: `Service contract ${contract.ServiceContract} determined (${contract.ServiceContractDescription}).` };
    }

    /**
     * Executes one step of the plan for a run.
     *
     * @param {object} run run state of MockExecutionProvider (dataset, correlation, documents so far)
     * @param {object} step plan step
     * @returns {{ok:boolean, blocked?:boolean, document?:object, documentId?:string, actualStatus:string, message:string}} step result
     */
    executeStep(run, step) {
        const data = run.dataset.data;
        const caseId = run.correlation.caseId;
        const docs = run.documents;
        const byType = (type) => docs.find((d) => d.businessObjectType === type);
        const contractDoc = byType(BO.SERVICE_CONTRACT);
        const hasOrderInPlan = (run.plan || CHAIN).some((s) => s.businessObjectType === BO.SERVICE_ORDER);
        // contract billing plan (no order in the path): items from the contract, otherwise from the test data
        const { items, net, notes } = contractDoc && !hasOrderInPlan ? this.billingPlanItems(contractDoc.document) : this.items(data);
        const currency = data.TransactionCurrency || 'EUR';
        let documentId;
        let document;
        let predecessor;
        let created = true;
        switch (step.businessObjectType) {
            case BO.SERVICE_CONTRACT: {
                const determination = this.determineContract(run);
                if (!determination.ok) {
                    // precondition of the variant missing → the run is BLOCKED, not a technical error
                    return { ok: false, blocked: true, actualStatus: 'Not determined', message: determination.message };
                }
                const contract = determination.contract;
                documentId = contract.ServiceContract;
                document = {
                    ServiceContract: contract.ServiceContract,
                    ServiceContractDescription: contract.ServiceContractDescription,
                    SoldToParty: contract.SoldToParty,
                    ServiceContractStartDateTime: contract.ServiceContractStartDate,
                    ServiceContractEndDateTime: contract.ServiceContractEndDate,
                    ServiceContractIsReleased: true,
                    Product: contract.Product,
                    BillingPlanNetAmount: contract.BillingPlanNetAmount,
                    to_ObjectList: [{ ServiceRefFunctionalLocation: contract.ServiceRefFunctionalLocation }],
                    LifecycleStatus: 'Released'
                };
                // an existing document: no number is drawn
                created = false;
                break;
            }
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
                const existing = byType(BO.SERVICE_QUOTATION);
                if (existing) {
                    // SIM-10 customer decision on the quotation sent before (status change, no new number)
                    const accepted = step.expectedStatus !== 'Rejected';
                    Object.assign(existing.document, {
                        ServiceQuotationIsAccepted: accepted,
                        ServiceQuotationIsRejected: !accepted,
                        LifecycleStatus: accepted ? 'Accepted' : 'Rejected'
                    });
                    existing.lifecycleStatus = existing.document.LifecycleStatus;
                    return {
                        ok: true,
                        document: existing.document,
                        documentId: existing.documentId,
                        actualStatus: existing.document.LifecycleStatus,
                        message: `${existing.documentId} ${accepted ? 'accepted by the customer' : 'rejected by the customer – no follow-up order'}.`
                    };
                }
                predecessor = byType(BO.SERVICE_REQUEST);
                documentId = String(numberRanges.next(this.tenantId, 'QUOTATION_ORDER'));
                const status = step.expectedStatus || 'Accepted';
                document = {
                    ServiceQuotation: documentId,
                    SoldToParty: data.SoldToParty,
                    RespyMgmtServiceTeam: data.RespyMgmtServiceTeam,
                    ServiceQtanExtReference: caseId,
                    to_Item: items,
                    ServiceDocNetAmount: net,
                    TransactionCurrency: currency,
                    ServiceQuotationIsReleased: true,
                    ServiceQuotationIsAccepted: status === 'Accepted',
                    ServiceQuotationIsRejected: status === 'Rejected',
                    LifecycleStatus: status
                };
                break;
            }
            case BO.SERVICE_ORDER: {
                predecessor = byType(BO.SERVICE_QUOTATION) || byType(BO.SERVICE_REQUEST) || contractDoc;
                documentId = String(numberRanges.next(this.tenantId, 'QUOTATION_ORDER'));
                document = {
                    ServiceOrder: documentId,
                    ReferenceServiceRequest: byType(BO.SERVICE_REQUEST)?.documentId,
                    // contract determination result (A_ServiceOrder.ReferenceServiceContract)
                    ReferenceServiceContract: contractDoc?.documentId || '',
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
                    to_Item: items.map((item) => ({ ...item, ReferenceServiceContract: contractDoc?.documentId || '' })),
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
                // Time & material: billing from the confirmation; fixed price: billing from the order (⚠ to verify, F-7);
                // contract billing plan: billing request item of the contract (A_SrvcContrItmBillgReqItem)
                if (!hasOrderInPlan && contractDoc) {
                    predecessor = contractDoc;
                } else if (run.dataset.processProfile === 'FS_FIXPRICE') {
                    predecessor = byType(BO.SERVICE_ORDER);
                } else {
                    predecessor = byType(BO.SERVICE_CONFIRMATION) || byType(BO.SERVICE_ORDER);
                }
                documentId = String(numberRanges.next(this.tenantId, 'BILLING_DOC_REQUEST'));
                document = {
                    BillingDocumentRequest: documentId,
                    ReferenceDocument: predecessor?.documentId,
                    ReferenceDocSDDocCategory: predecessor?.businessObjectType,
                    SoldToParty: data.SoldToParty || contractDoc?.document.SoldToParty,
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
                // SIM-11 transfer to accounting with the billing document (A_BillingDocument.AccountingDocument)
                const accountingDocument = String(numberRanges.next(this.tenantId, 'ACCOUNTING_DOCUMENT'));
                document = {
                    BillingDocument: documentId,
                    SoldToParty: data.SoldToParty || contractDoc?.document.SoldToParty,
                    PurchaseOrderByCustomer: caseId,
                    to_Item: items.map((item) => ({ Material: item.Product, BillingQuantity: item.Quantity, BillingQuantityUnit: item.QuantityUnit, NetAmount: item.NetAmount, ReferenceSDDocument: predecessor?.documentId })),
                    TotalNetAmount: net,
                    TransactionCurrency: currency,
                    CompanyCode: data.SalesOrganization || '',
                    FiscalYear: String(new Date(clock.now()).getUTCFullYear()),
                    AccountingDocument: accountingDocument,
                    OverallBillingStatus: 'C',
                    AccountingPostingStatus: 'C',
                    BillingDocumentIsCancelled: false,
                    LifecycleStatus: 'Posted'
                };
                break;
            }
            case BO.ACCOUNTING_DOCUMENT: {
                // reads the posting of the billing document (journal entry; real read API ⚠ to verify)
                predecessor = byType(BO.BILLING_DOCUMENT);
                const billing = predecessor?.document;
                if (!billing || billing.AccountingPostingStatus !== 'C' || !billing.AccountingDocument) {
                    return { ok: false, actualStatus: 'Not posted', message: 'The billing document was not transferred to accounting.' };
                }
                documentId = billing.AccountingDocument;
                document = {
                    AccountingDocument: documentId,
                    CompanyCode: billing.CompanyCode,
                    FiscalYear: billing.FiscalYear,
                    ReferenceDocument: billing.BillingDocument,
                    Customer: billing.SoldToParty,
                    AmountInTransactionCurrency: billing.TotalNetAmount,
                    TransactionCurrency: billing.TransactionCurrency,
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
            processStepID: step.processStepID || '',
            predecessorId: predecessor?.documentId || '',
            predecessorType: predecessor?.businessObjectType || '',
            lifecycleStatus: document.LifecycleStatus,
            netAmount: document.TotalNetAmount ?? document.ServiceDocNetAmount ?? document.AmountInTransactionCurrency ?? null,
            currency,
            created,
            document
        };
        if (predecessor) {
            predecessor.successorId = documentId;
        }
        docs.push(entry);
        const pricingNote = notes.length && (step.businessObjectType === BO.SERVICE_QUOTATION || step.businessObjectType === BO.SERVICE_ORDER) ? ` Pricing incomplete: ${notes.join('; ')}.` : '';
        const verb = step.businessObjectType === BO.SERVICE_CONTRACT ? 'determined' : step.businessObjectType === BO.ACCOUNTING_DOCUMENT ? 'posted' : 'created';
        return { ok: true, document, documentId, actualStatus: document.LifecycleStatus, message: `${documentId} ${verb}.${pricingNote}` };
    }
}

module.exports = { CHAIN, MockS4ServiceChain, MockS4DocumentStore };
