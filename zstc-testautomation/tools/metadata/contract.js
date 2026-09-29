'use strict';
/**
 * OData V4 mock contract of the project facade ZUI_STC_TEST_CASE_O4 (project proposal, NOT an SAP standard service).
 *
 * Single source of truth for webapp/localService/mainService/metadata.xml (see generate.js).
 * Conventions follow RAP-generated V4 metadata (checked against real SAP RAP metadata, see
 * docs/phase-1-architektur-und-mock-vertrag.md, section 3.1):
 *   - namespace com.sap.gateway.srvd.<service definition>.v0001, alias SAP__self, entity types <EntitySet>Type
 *   - UUID keys + IsActiveEntity for draft, draft actions Edit/Prepare/Activate/Discard
 *   - SAP__Messages, __EntityControl, __OperationControl, __FieldControl
 * Business field names follow the released S/4HANA APIs (A_ServiceRequest, A_ServiceOrderItem, ...).
 */
const { V } = require('./edmx');

const NS = 'com.sap.gateway.srvd.zui_stc_test_case.v0001';
const T = (name) => `${NS}.${name}Type`;

/* ------------------------------------------------------------------------------------------------ */
/* Property helpers                                                                                  */
/* ------------------------------------------------------------------------------------------------ */
const str = (name, maxLength, label, opts = {}) => ({ name, type: 'Edm.String', maxLength, label, ...opts });
const longText = (name, label, opts = {}) => ({ name, type: 'Edm.String', label, multiLine: true, ...opts });
const guid = (name, label, opts = {}) => ({ name, type: 'Edm.Guid', label, ...opts });
const bool = (name, label, opts = {}) => ({ name, type: 'Edm.Boolean', label, ...opts });
const dec = (name, precision, scale, label, opts = {}) => ({ name, type: 'Edm.Decimal', precision, scale, label, ...opts });
const dto = (name, label, opts = {}) => ({ name, type: 'Edm.DateTimeOffset', precision: 7, label, ...opts });
const int16 = (name, label, opts = {}) => ({ name, type: 'Edm.Int16', label, ...opts });
const int32 = (name, label, opts = {}) => ({ name, type: 'Edm.Int32', label, ...opts });
const byte = (name, label, opts = {}) => ({ name, type: 'Edm.Byte', label, ...opts });
/** Criticality helper property (UI.CriticalityType values 0..5), computed and hidden */
const crit = (name) => byte(name, 'Criticality', { computed: true, hidden: true });

/** single-valued association to a value help / code list entity set used for texts */
const textNav = (name, target, sourceProp, targetProp) => ({
    name,
    target,
    constraints: [[sourceProp, targetProp]]
});

/* ------------------------------------------------------------------------------------------------ */
/* Value help and code list entity sets (read-only)                                                  */
/* ------------------------------------------------------------------------------------------------ */
const valueHelps = [
    {
        name: 'CustomerVH',
        realBasis: 'I_Customer / I_Customer_VH',
        keys: ['Customer'],
        props: [
            str('Customer', 10, 'Customer', { text: 'CustomerName', textArrangement: 'TextFirst' }),
            str('CustomerName', 80, 'Customer Name'),
            str('CityName', 40, 'City'),
            str('Country', 3, 'Country')
        ]
    },
    {
        name: 'ContactPersonVH',
        realBasis: 'I_BusinessPartner + contact person relationship',
        keys: ['BusinessPartner'],
        props: [
            str('BusinessPartner', 10, 'Contact Person', { text: 'BusinessPartnerFullName', textArrangement: 'TextFirst' }),
            str('BusinessPartnerFullName', 80, 'Name'),
            str('FirstName', 40, 'First Name'),
            str('LastName', 40, 'Last Name'),
            str('Customer', 10, 'Customer')
        ]
    },
    {
        name: 'FunctionalLocationVH',
        realBasis: 'I_FunctionalLocation (+ partner assignment)',
        keys: ['FunctionalLocation'],
        props: [
            str('FunctionalLocation', 40, 'Functional Location', { text: 'FunctionalLocationName', textArrangement: 'TextFirst' }),
            str('FunctionalLocationName', 40, 'Description'),
            str('Customer', 10, 'Customer'),
            str('MaintenancePlant', 4, 'Plant')
        ]
    },
    {
        name: 'EquipmentVH',
        realBasis: 'I_Equipment / I_EquipmentStdVH',
        keys: ['Equipment'],
        props: [
            str('Equipment', 18, 'Equipment', { text: 'EquipmentName', textArrangement: 'TextFirst' }),
            str('EquipmentName', 40, 'Description'),
            str('FunctionalLocation', 40, 'Functional Location'),
            str('Material', 40, 'Reference Product'),
            str('SerialNumber', 18, 'Serial Number'),
            str('Customer', 10, 'Customer')
        ]
    },
    {
        name: 'ProductVH',
        realBasis: 'I_Product + I_ProductDescription',
        keys: ['Product'],
        props: [
            str('Product', 40, 'Product', { text: 'ProductDescription', textArrangement: 'TextFirst' }),
            str('ProductDescription', 40, 'Description'),
            str('ProductType', 4, 'Product Type'),
            str('BaseUnit', 3, 'Base Unit')
        ]
    },
    {
        name: 'SalesOrganizationVH',
        realBasis: 'I_SalesOrganization',
        keys: ['SalesOrganization'],
        props: [
            str('SalesOrganization', 4, 'Sales Organization', { text: 'SalesOrganizationName', textArrangement: 'TextFirst' }),
            str('SalesOrganizationName', 40, 'Name')
        ]
    },
    {
        name: 'ServiceOrganizationVH',
        realBasis: 'organizational model (to verify)',
        keys: ['ServiceOrganization'],
        props: [
            str('ServiceOrganization', 14, 'Service Organization', { text: 'ServiceOrganizationName', textArrangement: 'TextFirst' }),
            str('ServiceOrganizationName', 40, 'Name'),
            str('SalesOrganization', 4, 'Sales Organization')
        ]
    },
    {
        name: 'ServiceTeamVH',
        realBasis: 'Responsibility Management team (to verify)',
        keys: ['RespyMgmtServiceTeam'],
        props: [
            str('RespyMgmtServiceTeam', 20, 'Service Team', { text: 'RespyMgmtServiceTeamName', textArrangement: 'TextFirst' }),
            str('RespyMgmtServiceTeamName', 40, 'Team Name'),
            str('ServiceOrganization', 14, 'Service Organization')
        ]
    },
    {
        name: 'ServiceDocumentPriorityVH',
        realBasis: 'service priority code list (to verify)',
        keys: ['ServiceDocumentPriority'],
        props: [
            str('ServiceDocumentPriority', 1, 'Priority', { text: 'ServiceDocumentPriorityName', textArrangement: 'TextOnly' }),
            str('ServiceDocumentPriorityName', 20, 'Priority Name')
        ]
    },
    {
        name: 'ServiceRequestTypeVH',
        realBasis: 'transaction type customizing (to verify)',
        keys: ['ServiceRequestType'],
        props: [
            str('ServiceRequestType', 4, 'Service Request Type', { text: 'ServiceRequestTypeName', textArrangement: 'TextFirst' }),
            str('ServiceRequestTypeName', 40, 'Description')
        ]
    },
    {
        name: 'UnitOfMeasureVH',
        realBasis: 'I_UnitOfMeasure',
        keys: ['UnitOfMeasure'],
        props: [
            str('UnitOfMeasure', 3, 'Unit', { text: 'UnitOfMeasureName', textArrangement: 'TextFirst' }),
            str('UnitOfMeasureName', 30, 'Unit Name'),
            str('UnitOfMeasureDimension', 6, 'Dimension')
        ]
    },
    {
        name: 'CurrencyVH',
        realBasis: 'I_Currency',
        keys: ['Currency'],
        props: [str('Currency', 5, 'Currency', { text: 'CurrencyName', textArrangement: 'TextFirst' }), str('CurrencyName', 40, 'Name')]
    },
    {
        name: 'ProcessProfileVH',
        realBasis: 'project configuration (ZI_STC_ProcessProfileVH)',
        keys: ['ProcessProfile'],
        props: [
            str('ProcessProfile', 20, 'Process Profile', { text: 'ProcessProfileName', textArrangement: 'TextFirst' }),
            str('ProcessProfileName', 60, 'Name')
        ]
    },
    {
        name: 'TestCaseFieldVH',
        realBasis: 'project field catalog of TestCaseData',
        keys: ['FieldName'],
        props: [
            str('FieldName', 40, 'Field', { text: 'FieldLabel', textArrangement: 'TextFirst' }),
            str('FieldLabel', 60, 'Field Label'),
            str('BusinessObject', 30, 'Business Object')
        ]
    }
];

/** Code lists with generic Code/Text shape (project proposal) */
// [entity set, label, max. length of the text] — short texts keep the status columns narrow
const codeListNames = [
    ['LifecycleStatusVH', 'Lifecycle Status', 20],
    ['ValidationStatusVH', 'Validation Status', 20],
    ['ApprovalStatusVH', 'Approval Status', 20],
    ['ExecutionStatusVH', 'Execution Status', 20],
    ['FinalResultVH', 'Result', 20],
    ['BusinessObjectTypeVH', 'Business Object', 30],
    ['ValidationCategoryVH', 'Category', 20],
    ['ValidationItemStatusVH', 'Status', 20],
    ['ValidationRuleVH', 'Validation Rule', 60],
    ['SourceTypeVH', 'Source', 20],
    ['StepStatusVH', 'Step Status', 20],
    ['AssertionResultVH', 'Result', 20],
    ['ExecutionProviderVH', 'Execution Provider', 60]
];
const codeLists = codeListNames.map(([name, label, textLength]) => ({
    name,
    codeList: true,
    keys: ['Code'],
    props: [str('Code', 30, label, { text: 'Text', textArrangement: 'TextOnly' }), str('Text', textLength, 'Description')]
}));

/* ------------------------------------------------------------------------------------------------ */
/* Business objects                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

/** Fields of TestCaseData that are controlled by FieldRequirement (dynamic Common.FieldControl) */
const controlledDataFields = [
    'ServiceRequestType',
    'ServiceRequestDescription',
    'SoldToParty',
    'ServiceRequestReporter',
    'ServiceDocumentPriority',
    'SalesOrganization',
    'ServiceOrganization',
    'RespyMgmtServiceTeam',
    'ServiceProfile',
    'ResponseProfile',
    'RequestedServiceStartDateTime',
    'RequestedServiceEndDateTime',
    'ServiceRefFunctionalLocation',
    'ServiceReferenceEquipment',
    'ReferenceProduct',
    'ServiceProduct',
    'ServiceDuration',
    'ServiceDurationUnit',
    'ServicePart',
    'ServicePartQuantity',
    'ServicePartQuantityUnit',
    'ExpectedNetAmount',
    'NetAmountTolerance',
    'TransactionCurrency'
];

const testCaseActions = [
    'analyze',
    'validate',
    'approve',
    'startExecution',
    'refreshExecution',
    'cancelExecution',
    'revalidate'
];

const entities = [
    /* ------------------------------ BO 1: Test case (draft root) ------------------------------ */
    {
        name: 'TestCase',
        draft: 'root',
        keys: ['TestCaseUUID'],
        messages: true,
        entityControl: true,
        operationControl: testCaseActions,
        props: [
            guid('TestCaseUUID', 'Test Case UUID', { nullable: false, computed: true, hidden: true }),
            str('CaseID', 20, 'Case ID', { computed: true }),
            str('ScenarioID', 20, 'Scenario ID'),
            str('Title', 80, 'Title'),
            str('Description', 1000, 'Description', { multiLine: true }),
            longText('NaturalLanguageInput', 'Describe Test Scenario'),
            str('ProcessProfile', 20, 'Process Profile', {
                text: '_ProcessProfile/ProcessProfileName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ProcessProfileVH', key: 'ProcessProfile', display: ['ProcessProfileName'], fixed: true }
            }),
            str('Status', 20, 'Lifecycle Status', { computed: true, text: '_Status/Text', textArrangement: 'TextOnly' }),
            crit('StatusCriticality'),
            str('ValidationStatus', 20, 'Validation', { computed: true, text: '_ValidationStatus/Text', textArrangement: 'TextOnly' }),
            crit('ValidationCriticality'),
            str('ApprovalStatus', 20, 'Approval', { computed: true, text: '_ApprovalStatus/Text', textArrangement: 'TextOnly' }),
            crit('ApprovalCriticality'),
            str('ExecutionStatus', 20, 'Execution Status', { computed: true, text: '_ExecutionStatus/Text', textArrangement: 'TextOnly' }),
            crit('ExecutionCriticality'),
            str('FinalResult', 25, 'Final Result', { computed: true, text: '_FinalResult/Text', textArrangement: 'TextOnly' }),
            crit('FinalResultCriticality'),
            str('CreatedBy', 12, 'Created By', { computed: true }),
            dto('CreatedAt', 'Created At', { computed: true }),
            dto('ChangedAt', 'Changed At', { computed: true }),
            str('ApprovedBy', 12, 'Approved By', { computed: true }),
            dto('ApprovedAt', 'Approved At', { computed: true }),
            dto('ExecutionStartedAt', 'Execution Started', { computed: true }),
            dto('ExecutionFinishedAt', 'Execution Finished', { computed: true }),
            int32('ExecutionDuration', 'Duration (s)', { computed: true }),
            str('ExternalExecutionID', 40, 'External Execution ID', { computed: true }),
            guid('LatestExecutionUUID', 'Latest Execution', { computed: true, hidden: true })
        ],
        navs: [
            { name: '_TestCaseData', target: 'TestCaseData', partner: '_TestCase', constraints: [['TestCaseUUID', 'TestCaseUUID']], cascade: true },
            { name: '_ValidationResult', target: 'ValidationResult', collection: true, partner: '_TestCase', constraints: [['TestCaseUUID', 'TestCaseUUID']], cascade: true },
            { name: '_Execution', target: 'Execution', collection: true, partner: '_TestCase', constraints: [['TestCaseUUID', 'TestCaseUUID']], cascade: true },
            { name: '_LatestExecution', target: 'Execution', constraints: [['LatestExecutionUUID', 'ExecutionUUID']] },
            { name: '_LatestExecutionStep', target: 'ExecutionStep', collection: true, constraints: [['LatestExecutionUUID', 'ExecutionUUID']] },
            { name: '_LatestDocumentReference', target: 'DocumentReference', collection: true, constraints: [['LatestExecutionUUID', 'ExecutionUUID']] },
            { name: '_LatestTestAssertion', target: 'TestAssertion', collection: true, constraints: [['LatestExecutionUUID', 'ExecutionUUID']] },
            textNav('_ProcessProfile', 'ProcessProfileVH', 'ProcessProfile', 'ProcessProfile'),
            textNav('_Status', 'LifecycleStatusVH', 'Status', 'Code'),
            textNav('_ValidationStatus', 'ValidationStatusVH', 'ValidationStatus', 'Code'),
            textNav('_ApprovalStatus', 'ApprovalStatusVH', 'ApprovalStatus', 'Code'),
            textNav('_ExecutionStatus', 'ExecutionStatusVH', 'ExecutionStatus', 'Code'),
            textNav('_FinalResult', 'FinalResultVH', 'FinalResult', 'Code')
        ]
    },
    /* ------------------------------ TestCaseData (1:1 composition) ------------------------------ */
    {
        name: 'TestCaseData',
        draft: 'node',
        keys: ['TestCaseUUID'],
        fieldControl: controlledDataFields,
        props: [
            guid('TestCaseUUID', 'Test Case UUID', { nullable: false, computed: true, hidden: true }),
            // Service Request (A_ServiceRequest)
            str('ServiceRequestType', 4, 'Service Request Type', {
                text: '_ServiceRequestType/ServiceRequestTypeName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ServiceRequestTypeVH', key: 'ServiceRequestType', display: ['ServiceRequestTypeName'], fixed: true }
            }),
            str('ServiceRequestDescription', 40, 'Problem Description'),
            str('SoldToParty', 10, 'Sold-to Party', {
                text: '_Customer/CustomerName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'CustomerVH', key: 'Customer', display: ['CustomerName', 'CityName', 'Country'] }
            }),
            str('ServiceRequestReporter', 10, 'Reporter', {
                text: '_Reporter/BusinessPartnerFullName',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'ContactPersonVH',
                    key: 'BusinessPartner',
                    display: ['BusinessPartnerFullName'],
                    in: [['SoldToParty', 'Customer']]
                }
            }),
            str('ServiceDocumentPriority', 1, 'Priority', {
                text: '_Priority/ServiceDocumentPriorityName',
                textArrangement: 'TextOnly',
                valueList: {
                    collection: 'ServiceDocumentPriorityVH',
                    key: 'ServiceDocumentPriority',
                    display: ['ServiceDocumentPriorityName'],
                    fixed: true
                }
            }),
            str('SalesOrganization', 4, 'Sales Organization', {
                text: '_SalesOrganization/SalesOrganizationName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'SalesOrganizationVH', key: 'SalesOrganization', display: ['SalesOrganizationName'] }
            }),
            str('SalesOrganizationOrgUnitID', 14, 'Sales Org. Unit ID', { computed: true }),
            str('ServiceOrganization', 14, 'Service Organization', {
                text: '_ServiceOrganization/ServiceOrganizationName',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'ServiceOrganizationVH',
                    key: 'ServiceOrganization',
                    display: ['ServiceOrganizationName'],
                    in: [['SalesOrganization', 'SalesOrganization']]
                }
            }),
            str('RespyMgmtServiceTeam', 20, 'Service Team', {
                text: '_ServiceTeam/RespyMgmtServiceTeamName',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'ServiceTeamVH',
                    key: 'RespyMgmtServiceTeam',
                    display: ['RespyMgmtServiceTeamName'],
                    in: [['ServiceOrganization', 'ServiceOrganization']]
                }
            }),
            str('ServiceProfile', 10, 'Service Profile'),
            str('ResponseProfile', 10, 'Response Profile'),
            dto('RequestedServiceStartDateTime', 'Requested Start'),
            dto('RequestedServiceEndDateTime', 'Requested End'),
            // Reference object (A_ServiceRequestRefObject / API_EQUIPMENT)
            str('ServiceRefFunctionalLocation', 40, 'Functional Location', {
                text: '_FunctionalLocation/FunctionalLocationName',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'FunctionalLocationVH',
                    key: 'FunctionalLocation',
                    display: ['FunctionalLocationName', 'MaintenancePlant'],
                    in: [['SoldToParty', 'Customer']]
                }
            }),
            str('ServiceReferenceEquipment', 18, 'Equipment', {
                text: '_Equipment/EquipmentName',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'EquipmentVH',
                    key: 'Equipment',
                    display: ['EquipmentName', 'SerialNumber'],
                    in: [['ServiceRefFunctionalLocation', 'FunctionalLocation']],
                    out: [['ReferenceProduct', 'Material']]
                }
            }),
            str('ReferenceProduct', 40, 'Reference Product', {
                text: '_ReferenceProduct/ProductDescription',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ProductVH', key: 'Product', display: ['ProductDescription'], constants: [['ProductType', 'FERT']] }
            }),
            // Service order items (A_ServiceOrderItem)
            str('ServiceProduct', 40, 'Service Product', {
                text: '_ServiceProduct/ProductDescription',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'ProductVH',
                    key: 'Product',
                    display: ['ProductDescription', 'BaseUnit'],
                    constants: [['ProductType', 'SERV']],
                    out: [['ServiceDurationUnit', 'BaseUnit']]
                }
            }),
            dec('ServiceDuration', 13, 3, 'Service Duration', { unit: 'ServiceDurationUnit' }),
            str('ServiceDurationUnit', 3, 'Duration Unit', {
                valueList: { collection: 'UnitOfMeasureVH', key: 'UnitOfMeasure', display: ['UnitOfMeasureName'], constants: [['UnitOfMeasureDimension', 'TIME']] }
            }),
            str('ServicePart', 40, 'Service Part', {
                text: '_ServicePart/ProductDescription',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'ProductVH',
                    key: 'Product',
                    display: ['ProductDescription', 'BaseUnit'],
                    constants: [['ProductType', 'ERSA']],
                    out: [['ServicePartQuantityUnit', 'BaseUnit']]
                }
            }),
            dec('ServicePartQuantity', 13, 3, 'Part Quantity', { unit: 'ServicePartQuantityUnit' }),
            str('ServicePartQuantityUnit', 3, 'Quantity Unit', {
                valueList: { collection: 'UnitOfMeasureVH', key: 'UnitOfMeasure', display: ['UnitOfMeasureName'] }
            }),
            // Expected result (billing)
            dec('ExpectedNetAmount', 15, 2, 'Expected Net Value', { currency: 'TransactionCurrency' }),
            dec('NetAmountTolerance', 15, 2, 'Net Value Tolerance', { currency: 'TransactionCurrency' }),
            str('TransactionCurrency', 5, 'Currency', {
                valueList: { collection: 'CurrencyVH', key: 'Currency', display: ['CurrencyName'] }
            })
        ],
        navs: [
            { name: '_TestCase', target: 'TestCase', partner: '_TestCaseData', nullable: false, constraints: [['TestCaseUUID', 'TestCaseUUID']] },
            textNav('_ServiceRequestType', 'ServiceRequestTypeVH', 'ServiceRequestType', 'ServiceRequestType'),
            textNav('_Customer', 'CustomerVH', 'SoldToParty', 'Customer'),
            textNav('_Reporter', 'ContactPersonVH', 'ServiceRequestReporter', 'BusinessPartner'),
            textNav('_Priority', 'ServiceDocumentPriorityVH', 'ServiceDocumentPriority', 'ServiceDocumentPriority'),
            textNav('_SalesOrganization', 'SalesOrganizationVH', 'SalesOrganization', 'SalesOrganization'),
            textNav('_ServiceOrganization', 'ServiceOrganizationVH', 'ServiceOrganization', 'ServiceOrganization'),
            textNav('_ServiceTeam', 'ServiceTeamVH', 'RespyMgmtServiceTeam', 'RespyMgmtServiceTeam'),
            textNav('_FunctionalLocation', 'FunctionalLocationVH', 'ServiceRefFunctionalLocation', 'FunctionalLocation'),
            textNav('_Equipment', 'EquipmentVH', 'ServiceReferenceEquipment', 'Equipment'),
            textNav('_ReferenceProduct', 'ProductVH', 'ReferenceProduct', 'Product'),
            textNav('_ServiceProduct', 'ProductVH', 'ServiceProduct', 'Product'),
            textNav('_ServicePart', 'ProductVH', 'ServicePart', 'Product')
        ]
    },
    /* ------------------------------ ValidationResult ------------------------------ */
    {
        name: 'ValidationResult',
        draft: 'node',
        keys: ['ValidationUUID'],
        operationControl: ['applySuggestion'],
        props: [
            guid('ValidationUUID', 'Validation UUID', { nullable: false, computed: true, hidden: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            int16('Sequence', 'No.', { computed: true }),
            str('BusinessObjectType', 30, 'Business Object', { computed: true, text: '_BusinessObjectType/Text', textArrangement: 'TextOnly' }),
            str('Category', 20, 'Category', { computed: true, text: '_Category/Text', textArrangement: 'TextOnly' }),
            str('FieldName', 40, 'Field', { computed: true, text: '_Field/FieldLabel', textArrangement: 'TextOnly' }),
            str('ProposedValue', 80, 'Entered Value', { computed: true }),
            str('ResolvedValue', 80, 'Resolved Value', { computed: true }),
            str('SuggestedValue', 80, 'Suggestion', { computed: true }),
            str('SuggestedValues', 255, 'All Suggestions', { computed: true }),
            str('Source', 20, 'Source', { computed: true, text: '_Source/Text', textArrangement: 'TextOnly' }),
            str('RuleID', 30, 'Rule', { computed: true, text: '_Rule/Text', textArrangement: 'TextOnly' }),
            str('ValidationStatus', 10, 'Status', { computed: true, text: '_Status/Text', textArrangement: 'TextOnly' }),
            crit('Criticality'),
            str('ValidationMessage', 255, 'Message', { computed: true }),
            str('Severity', 10, 'Severity', { computed: true })
        ],
        navs: [
            { name: '_TestCase', target: 'TestCase', partner: '_ValidationResult', nullable: false, constraints: [['TestCaseUUID', 'TestCaseUUID']] },
            textNav('_BusinessObjectType', 'BusinessObjectTypeVH', 'BusinessObjectType', 'Code'),
            textNav('_Category', 'ValidationCategoryVH', 'Category', 'Code'),
            textNav('_Field', 'TestCaseFieldVH', 'FieldName', 'FieldName'),
            textNav('_Source', 'SourceTypeVH', 'Source', 'Code'),
            textNav('_Rule', 'ValidationRuleVH', 'RuleID', 'Code'),
            textNav('_Status', 'ValidationItemStatusVH', 'ValidationStatus', 'Code')
        ]
    },
    /* ------------------------------ Execution ------------------------------ */
    {
        name: 'Execution',
        draft: 'node',
        keys: ['ExecutionUUID'],
        props: [
            guid('ExecutionUUID', 'Execution UUID', { nullable: false, computed: true, hidden: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            str('ExecutionProvider', 30, 'Execution Provider', { computed: true, text: '_ExecutionProvider/Text', textArrangement: 'TextOnly' }),
            str('ExternalExecutionID', 40, 'External Execution ID', { computed: true }),
            str('CorrelationReference', 35, 'Customer Reference', { computed: true }),
            str('Status', 20, 'Status', { computed: true, text: '_Status/Text', textArrangement: 'TextOnly' }),
            crit('StatusCriticality'),
            int16('ProgressPercent', 'Progress (%)', { computed: true }),
            dto('StartedAt', 'Started At', { computed: true }),
            dto('FinishedAt', 'Finished At', { computed: true }),
            int32('DurationInSeconds', 'Duration (s)', { computed: true }),
            str('TechnicalResult', 10, 'Technical Result', { computed: true }),
            str('FunctionalResult', 25, 'Functional Result', { computed: true, text: '_FunctionalResult/Text', textArrangement: 'TextOnly' }),
            crit('FunctionalResultCriticality'),
            longText('TechnicalLog', 'Technical Log', { computed: true })
        ],
        navs: [
            { name: '_TestCase', target: 'TestCase', partner: '_Execution', nullable: false, constraints: [['TestCaseUUID', 'TestCaseUUID']] },
            { name: '_ExecutionStep', target: 'ExecutionStep', collection: true, partner: '_Execution', constraints: [['ExecutionUUID', 'ExecutionUUID']], cascade: true },
            { name: '_DocumentReference', target: 'DocumentReference', collection: true, partner: '_Execution', constraints: [['ExecutionUUID', 'ExecutionUUID']], cascade: true },
            { name: '_TestAssertion', target: 'TestAssertion', collection: true, partner: '_Execution', constraints: [['ExecutionUUID', 'ExecutionUUID']], cascade: true },
            textNav('_ExecutionProvider', 'ExecutionProviderVH', 'ExecutionProvider', 'Code'),
            textNav('_Status', 'ExecutionStatusVH', 'Status', 'Code'),
            textNav('_FunctionalResult', 'FinalResultVH', 'FunctionalResult', 'Code')
        ]
    },
    /* ------------------------------ ExecutionStep ------------------------------ */
    {
        name: 'ExecutionStep',
        draft: 'node',
        keys: ['StepUUID'],
        props: [
            guid('StepUUID', 'Step UUID', { nullable: false, computed: true, hidden: true }),
            guid('ExecutionUUID', 'Execution UUID', { computed: true, hidden: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            int16('Sequence', 'Step', { computed: true }),
            str('BusinessObjectType', 30, 'Business Object', { computed: true, text: '_BusinessObjectType/Text', textArrangement: 'TextOnly' }),
            str('ExpectedStatus', 30, 'Expected Status', { computed: true }),
            str('ActualStatus', 30, 'Actual Status', { computed: true }),
            str('ExecutionStatus', 20, 'Step Status', { computed: true, text: '_StepStatus/Text', textArrangement: 'TextOnly' }),
            crit('Criticality'),
            dto('StartedAt', 'Started At', { computed: true }),
            dto('FinishedAt', 'Finished At', { computed: true }),
            str('Message', 255, 'Message', { computed: true })
        ],
        navs: [
            { name: '_Execution', target: 'Execution', partner: '_ExecutionStep', nullable: false, constraints: [['ExecutionUUID', 'ExecutionUUID']] },
            textNav('_BusinessObjectType', 'BusinessObjectTypeVH', 'BusinessObjectType', 'Code'),
            textNav('_StepStatus', 'StepStatusVH', 'ExecutionStatus', 'Code')
        ]
    },
    /* ------------------------------ DocumentReference ------------------------------ */
    {
        name: 'DocumentReference',
        draft: 'node',
        keys: ['DocumentReferenceUUID'],
        props: [
            guid('DocumentReferenceUUID', 'Document Reference UUID', { nullable: false, computed: true, hidden: true }),
            guid('ExecutionUUID', 'Execution UUID', { computed: true, hidden: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            int16('Sequence', 'No.', { computed: true }),
            str('BusinessObjectType', 30, 'Business Object', { computed: true, text: '_BusinessObjectType/Text', textArrangement: 'TextOnly' }),
            str('DocumentID', 20, 'Document', { computed: true }),
            str('DocumentItem', 10, 'Item', { computed: true }),
            str('PredecessorDocumentID', 20, 'Predecessor', { computed: true }),
            str('SuccessorDocumentID', 60, 'Successors', { computed: true }),
            str('LifecycleStatus', 30, 'Lifecycle Status', { computed: true }),
            dec('NetAmount', 15, 2, 'Net Value', { computed: true, currency: 'TransactionCurrency' }),
            str('TransactionCurrency', 5, 'Currency', { computed: true }),
            str('ExternalURL', 255, 'Link', { computed: true }),
            str('ValidationStatus', 10, 'Check', { computed: true, text: '_Status/Text', textArrangement: 'TextOnly' }),
            crit('Criticality')
        ],
        navs: [
            { name: '_Execution', target: 'Execution', partner: '_DocumentReference', nullable: false, constraints: [['ExecutionUUID', 'ExecutionUUID']] },
            textNav('_BusinessObjectType', 'BusinessObjectTypeVH', 'BusinessObjectType', 'Code'),
            textNav('_Status', 'ValidationItemStatusVH', 'ValidationStatus', 'Code')
        ]
    },
    /* ------------------------------ TestAssertion ------------------------------ */
    {
        name: 'TestAssertion',
        draft: 'node',
        keys: ['AssertionUUID'],
        props: [
            guid('AssertionUUID', 'Assertion UUID', { nullable: false, computed: true, hidden: true }),
            guid('ExecutionUUID', 'Execution UUID', { computed: true, hidden: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            int16('Sequence', 'No.', { computed: true }),
            str('BusinessObjectType', 30, 'Business Object', { computed: true, text: '_BusinessObjectType/Text', textArrangement: 'TextOnly' }),
            str('Field', 40, 'Field', { computed: true }),
            str('ExpectedValue', 80, 'Expected', { computed: true }),
            str('ActualValue', 80, 'Actual', { computed: true }),
            str('Tolerance', 40, 'Tolerance', { computed: true }),
            str('Result', 20, 'Result', { computed: true, text: '_Result/Text', textArrangement: 'TextOnly' }),
            crit('Criticality'),
            str('Message', 255, 'Message', { computed: true })
        ],
        navs: [
            { name: '_Execution', target: 'Execution', partner: '_TestAssertion', nullable: false, constraints: [['ExecutionUUID', 'ExecutionUUID']] },
            textNav('_BusinessObjectType', 'BusinessObjectTypeVH', 'BusinessObjectType', 'Code'),
            textNav('_Result', 'AssertionResultVH', 'Result', 'Code')
        ]
    },
    /* ------------------------------ BO 2: Configuration (draft root) ------------------------------ */
    {
        name: 'ProcessProfile',
        draft: 'root',
        keys: ['ProcessProfile'],
        messages: true,
        entityControl: true,
        props: [
            str('ProcessProfile', 20, 'Process Profile', { nullable: false, immutable: true }),
            str('ProcessProfileName', 60, 'Name'),
            str('Description', 255, 'Description', { multiLine: true }),
            str('ExecutionProvider', 30, 'Execution Provider', {
                text: '_ExecutionProvider/Text',
                textArrangement: 'TextOnly',
                valueList: { collection: 'ExecutionProviderVH', key: 'Code', display: ['Text'], fixed: true }
            }),
            bool('RequiresSecondApprover', 'Four-Eyes Approval'),
            bool('IsActive', 'Active')
        ],
        navs: [
            {
                name: '_FieldRequirement',
                target: 'FieldRequirement',
                collection: true,
                partner: '_ProcessProfile',
                constraints: [['ProcessProfile', 'ProcessProfile']],
                cascade: true
            },
            textNav('_ExecutionProvider', 'ExecutionProviderVH', 'ExecutionProvider', 'Code')
        ]
    },
    {
        name: 'FieldRequirement',
        draft: 'node',
        keys: ['FieldRequirementUUID'],
        props: [
            guid('FieldRequirementUUID', 'Field Requirement UUID', { nullable: false, computed: true, hidden: true }),
            str('ProcessProfile', 20, 'Process Profile', { computed: true, hidden: true }),
            int16('Sequence', 'No.'),
            str('BusinessObject', 30, 'Business Object', {
                text: '_BusinessObject/Text',
                textArrangement: 'TextOnly',
                valueList: { collection: 'BusinessObjectTypeVH', key: 'Code', display: ['Text'], fixed: true }
            }),
            str('FieldName', 40, 'Field', {
                text: '_Field/FieldLabel',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'TestCaseFieldVH',
                    key: 'FieldName',
                    display: ['FieldLabel', 'BusinessObject'],
                    in: [['BusinessObject', 'BusinessObject']]
                }
            }),
            bool('Required', 'Required'),
            str('ValidationRule', 30, 'Validation Rule', {
                text: '_ValidationRule/Text',
                textArrangement: 'TextOnly',
                valueList: { collection: 'ValidationRuleVH', key: 'Code', display: ['Text'], fixed: true }
            }),
            str('DefaultValue', 80, 'Default Value'),
            str('SourceType', 20, 'Source', {
                text: '_SourceType/Text',
                textArrangement: 'TextOnly',
                valueList: { collection: 'SourceTypeVH', key: 'Code', display: ['Text'], fixed: true }
            }),
            bool('Active', 'Active')
        ],
        navs: [
            {
                name: '_ProcessProfile',
                target: 'ProcessProfile',
                partner: '_FieldRequirement',
                nullable: false,
                constraints: [['ProcessProfile', 'ProcessProfile']]
            },
            textNav('_BusinessObject', 'BusinessObjectTypeVH', 'BusinessObject', 'Code'),
            textNav('_Field', 'TestCaseFieldVH', 'FieldName', 'FieldName'),
            textNav('_ValidationRule', 'ValidationRuleVH', 'ValidationRule', 'Code'),
            textNav('_SourceType', 'SourceTypeVH', 'SourceType', 'Code')
        ]
    }
];

/* ------------------------------------------------------------------------------------------------ */
/* Actions                                                                                           */
/* ------------------------------------------------------------------------------------------------ */
const actions = [
    ...testCaseActions.map((name) => ({ name, boundTo: 'TestCase', returns: 'TestCase' })),
    {
        name: 'applySuggestion',
        boundTo: 'ValidationResult',
        returns: 'ValidationResult',
        params: [{ name: 'SelectedValue', type: 'Edm.String', maxLength: 80, label: 'Value to Apply' }]
    }
];

/* ------------------------------------------------------------------------------------------------ */
/* UI annotations                                                                                    */
/* ------------------------------------------------------------------------------------------------ */
const UI = 'SAP__UI';
/* Determining/inline actions (analyze, validate, applySuggestion) only in edit mode (draft), header actions only in display mode */
const hiddenInDisplayMode = ['SAP__UI.Hidden', V.path('IsActiveEntity')];
const hiddenInEditMode = ['SAP__UI.Hidden', V.not(V.path('IsActiveEntity'))];
/** UI.Importance of a line item column: the responsive table moves less important columns into the pop-in first */
const importance = (level) => (level ? [['SAP__UI.Importance', V.enum(`${UI}.ImportanceType/${level}`)]] : []);
const df = (value, label, extra = {}, level) =>
    V.rec(`${UI}.DataField`, { Value: V.path(value), Label: label ? V.str(label) : undefined, ...extra }, importance(level));
const dfCrit = (value, criticalityPath, label, level) =>
    V.rec(
        `${UI}.DataField`,
        {
            Value: V.path(value),
            Label: label ? V.str(label) : undefined,
            Criticality: V.path(criticalityPath),
            CriticalityRepresentation: V.enum(`${UI}.CriticalityRepresentationType/WithIcon`)
        },
        importance(level)
    );
const dfAction = (action, label, extra = {}, annos = []) =>
    V.rec(`${UI}.DataFieldForAction`, { Action: V.str(`${NS}.${action}`), Label: V.str(label), ...extra }, annos);
const refFacet = (id, label, target) => V.rec(`${UI}.ReferenceFacet`, { ID: V.str(id), Label: V.str(label), Target: V.annoPath(target) });
const collFacet = (id, label, facets) => V.rec(`${UI}.CollectionFacet`, { ID: V.str(id), Label: V.str(label), Facets: V.coll(facets) });
const fieldGroup = (label, fields) => V.rec(`${UI}.FieldGroupType`, { Label: label ? V.str(label) : undefined, Data: V.coll(fields) });
const dataPoint = (value, title, criticalityPath) =>
    V.rec(`${UI}.DataPointType`, { Value: V.path(value), Title: V.str(title), Criticality: V.path(criticalityPath) });
const headerInfo = (typeName, typeNamePlural, titlePath, descriptionPath) =>
    V.rec(`${UI}.HeaderInfoType`, {
        TypeName: V.str(typeName),
        TypeNamePlural: V.str(typeNamePlural),
        Title: V.rec(`${UI}.DataField`, { Value: V.path(titlePath) }),
        Description: descriptionPath ? V.rec(`${UI}.DataField`, { Value: V.path(descriptionPath) }) : undefined
    });
const sortBy = (property, descending = false) =>
    V.rec(`${UI}.PresentationVariantType`, {
        SortOrder: V.coll([V.rec('SAP__common.SortOrderType', { Property: V.propPath(property), Descending: V.bool(descending) })]),
        Visualizations: V.coll([V.annoPath('@UI.LineItem')])
    });

/** Side effects of the test case actions (targets relative to the binding parameter _it) */
const executionTargets = [
    '_it/ExecutionStatus',
    '_it/ExecutionCriticality',
    '_it/FinalResult',
    '_it/FinalResultCriticality',
    '_it/ExternalExecutionID',
    '_it/ExecutionStartedAt',
    '_it/ExecutionFinishedAt',
    '_it/ExecutionDuration',
    '_it/LatestExecutionUUID',
    '_it/Status',
    '_it/StatusCriticality',
    '_it/__OperationControl',
    '_it/__EntityControl'
];
const executionEntities = ['_it/_Execution', '_it/_LatestExecution', '_it/_LatestExecutionStep', '_it/_LatestDocumentReference', '_it/_LatestTestAssertion'];
const validationTargets = [
    '_it/ValidationStatus',
    '_it/ValidationCriticality',
    '_it/ApprovalStatus',
    '_it/ApprovalCriticality',
    '_it/Status',
    '_it/StatusCriticality',
    '_it/SAP__Messages',
    '_it/__OperationControl'
];
const sideEffects = (targetProperties, targetEntities = []) =>
    V.rec('SAP__common.SideEffectsType', {
        TargetProperties: targetProperties.length ? V.coll(targetProperties.map(V.str)) : undefined,
        TargetEntities: targetEntities.length ? V.coll(targetEntities.map(V.navPath)) : undefined
    });

const actionSideEffects = {
    analyze: sideEffects([...validationTargets, '_it/Title'], ['_it/_TestCaseData', '_it/_ValidationResult']),
    validate: sideEffects(validationTargets, ['_it/_ValidationResult', '_it/_TestCaseData']),
    approve: sideEffects(['_it/ApprovalStatus', '_it/ApprovalCriticality', '_it/ApprovedBy', '_it/ApprovedAt', '_it/Status', '_it/StatusCriticality', '_it/__OperationControl']),
    startExecution: sideEffects(executionTargets, executionEntities),
    refreshExecution: sideEffects(executionTargets, executionEntities),
    cancelExecution: sideEffects(executionTargets, executionEntities),
    revalidate: sideEffects(validationTargets, ['_it/_ValidationResult'])
};

const actionLabels = {
    analyze: 'Analyze',
    validate: 'Validate',
    approve: 'Approve',
    startExecution: 'Start Execution',
    refreshExecution: 'Refresh Status',
    cancelExecution: 'Cancel Execution',
    revalidate: 'Revalidate'
};

/** Annotations per target: [term, value, qualifier?, nestedAnnotations?] */
const annotations = {
    [`${NS}.TestCaseType`]: [
        ['SAP__common.SemanticKey', V.coll([V.propPath('CaseID')])],
        ['SAP__common.Messages', V.path('SAP__Messages')],
        ['SAP__UI.HeaderInfo', headerInfo('Test Case', 'Test Cases', 'CaseID', 'Title')],
        [
            'SAP__UI.HeaderFacets',
            V.coll([
                refFacet('HeaderScenario', 'Scenario', '@UI.FieldGroup#HeaderInfo'),
                refFacet('HeaderValidation', 'Validation', '@UI.DataPoint#Validation'),
                refFacet('HeaderApproval', 'Approval', '@UI.DataPoint#Approval'),
                refFacet('HeaderExecution', 'Execution', '@UI.DataPoint#Execution'),
                refFacet('HeaderResult', 'Final Result', '@UI.DataPoint#FinalResult')
            ])
        ],
        ['SAP__UI.DataPoint', dataPoint('ValidationStatus', 'Validation', 'ValidationCriticality'), 'Validation'],
        ['SAP__UI.DataPoint', dataPoint('ApprovalStatus', 'Approval', 'ApprovalCriticality'), 'Approval'],
        ['SAP__UI.DataPoint', dataPoint('ExecutionStatus', 'Execution Status', 'ExecutionCriticality'), 'Execution'],
        ['SAP__UI.DataPoint', dataPoint('FinalResult', 'Final Result', 'FinalResultCriticality'), 'FinalResult'],
        ['SAP__UI.FieldGroup', fieldGroup(undefined, [df('ScenarioID'), df('ProcessProfile'), df('CreatedBy'), df('CreatedAt')]), 'HeaderInfo'],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('CaseID', undefined, {}, 'High'),
                df('ScenarioID', 'Scenario', {}, 'Low'),
                df('Title', undefined, {}, 'High'),
                df('ProcessProfile', undefined, {}, 'Low'),
                df('CreatedAt', undefined, {}, 'Low'),
                dfCrit('ValidationStatus', 'ValidationCriticality', 'Validation', 'High'),
                dfCrit('ExecutionStatus', 'ExecutionCriticality', 'Execution', 'High'),
                dfCrit('FinalResult', 'FinalResultCriticality', 'Final Result', 'High'),
                df('ExecutionDuration', 'Duration (s)', {}, 'Low')
            ])
        ],
        ['SAP__UI.SelectionFields', V.coll([V.propPath('CaseID'), V.propPath('FinalResult'), V.propPath('CreatedAt'), V.propPath('ProcessProfile'), V.propPath('CreatedBy')])],
        ['SAP__UI.PresentationVariant', sortBy('CreatedAt', true)],
        [
            'SAP__UI.Identification',
            V.coll([
                dfAction('validate', actionLabels.validate, { Determining: V.bool(true) }, [hiddenInDisplayMode]),
                dfAction('approve', actionLabels.approve, {}, [hiddenInEditMode]),
                dfAction('startExecution', actionLabels.startExecution, {}, [hiddenInEditMode]),
                dfAction('refreshExecution', actionLabels.refreshExecution, {}, [hiddenInEditMode]),
                dfAction('cancelExecution', actionLabels.cancelExecution, {}, [hiddenInEditMode]),
                dfAction('revalidate', actionLabels.revalidate, {}, [hiddenInEditMode])
            ])
        ],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Scenario', [df('ScenarioID'), df('Title'), df('ProcessProfile'), df('Description')]),
            'Scenario'
        ],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Describe Test Scenario', [
                df('NaturalLanguageInput', 'Describe Test Scenario (optional)'),
                dfAction('analyze', actionLabels.analyze, {}, [hiddenInDisplayMode])
            ]),
            'Describe'
        ],
        ['SAP__UI.FieldGroup', fieldGroup('Approval', [df('ApprovalStatus'), df('ApprovedBy'), df('ApprovedAt')]), 'Approval'],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Execution', [
                df('ExternalExecutionID'),
                df('_LatestExecution/ExecutionProvider', 'Execution Provider'),
                df('ExecutionStatus'),
                df('_LatestExecution/ProgressPercent', 'Progress (%)'),
                df('ExecutionStartedAt'),
                df('ExecutionFinishedAt'),
                df('ExecutionDuration')
            ]),
            'Execution'
        ],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Technical Log', [df('_LatestExecution/CorrelationReference', 'Customer Reference (Case ID)'), df('_LatestExecution/TechnicalLog', 'Log')]),
            'TechnicalLog'
        ],
        [
            'SAP__UI.Facets',
            V.coll([
                collFacet('Input', 'Input', [refFacet('Scenario', 'Scenario', '@UI.FieldGroup#Scenario'), refFacet('Describe', 'Describe Test Scenario', '@UI.FieldGroup#Describe')]),
                collFacet('TestData', 'Validated Test Data', [
                    refFacet('ServiceRequest', '1 · Service Request', '_TestCaseData/@UI.FieldGroup#ServiceRequest'),
                    refFacet('ReferenceObject', '2 · Reference Object', '_TestCaseData/@UI.FieldGroup#ReferenceObject'),
                    refFacet('ServiceItem', '3 · Service Item', '_TestCaseData/@UI.FieldGroup#ServiceItem'),
                    refFacet('PartItem', '4 · Service Part', '_TestCaseData/@UI.FieldGroup#PartItem'),
                    refFacet('Expectation', '5 · Expected Result', '_TestCaseData/@UI.FieldGroup#Expectation')
                ]),
                refFacet('ValidationIssues', 'Validation Issues', '_ValidationResult/@UI.LineItem'),
                collFacet('ApprovalSection', 'Approval', [refFacet('ApprovalDetails', 'Approval', '@UI.FieldGroup#Approval')]),
                refFacet('SAPObjects', 'SAP Objects', '_LatestDocumentReference/@UI.LineItem'),
                // tables get their own collection facet (sub-section) next to forms
                collFacet('ExecutionSection', 'Execution', [
                    collFacet('ExecutionDetailsGroup', 'Latest Execution', [refFacet('ExecutionDetails', 'Execution', '@UI.FieldGroup#Execution')]),
                    collFacet('ExecutionStepsGroup', 'Steps', [refFacet('ExecutionSteps', 'Steps', '_LatestExecutionStep/@UI.LineItem')])
                ]),
                refFacet('Assertions', 'Test Assertions', '_LatestTestAssertion/@UI.LineItem'),
                collFacet('TechnicalLogSection', 'Technical Log', [
                    collFacet('TechnicalLogGroup', 'Latest Run', [refFacet('TechnicalLogDetails', 'Latest Run', '@UI.FieldGroup#TechnicalLog')]),
                    collFacet('ExecutionHistoryGroup', 'All Runs', [refFacet('ExecutionHistory', 'All Runs', '_Execution/@UI.LineItem#History')])
                ])
            ])
        ],
        [
            'SAP__common.SideEffects',
            V.rec('SAP__common.SideEffectsType', {
                SourceEntities: V.coll([V.navPath('_TestCaseData')]),
                TargetProperties: V.coll(
                    ['ValidationStatus', 'ValidationCriticality', 'ApprovalStatus', 'ApprovalCriticality', 'Status', 'StatusCriticality', 'SAP__Messages', '__OperationControl'].map(
                        V.str
                    )
                )
            }),
            'TestDataChanged'
        ],
        [
            'SAP__common.SideEffects',
            V.rec('SAP__common.SideEffectsType', {
                SourceProperties: V.coll([V.propPath('ProcessProfile')]),
                TargetProperties: V.coll(['ValidationStatus', 'ValidationCriticality', 'Status', 'StatusCriticality', '__OperationControl'].map(V.str)),
                TargetEntities: V.coll([V.navPath('_TestCaseData'), V.navPath('_ProcessProfile')])
            }),
            'ProcessProfileChanged'
        ]
    ],
    [`${NS}.TestCaseDataType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Test Data', 'Test Data', 'SoldToParty', 'ServiceRequestDescription')],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Service Request', [
                df('ServiceRequestType'),
                df('SoldToParty'),
                df('ServiceRequestReporter'),
                df('ServiceRequestDescription'),
                df('ServiceDocumentPriority'),
                df('SalesOrganization'),
                df('SalesOrganizationOrgUnitID'),
                df('ServiceOrganization'),
                df('RespyMgmtServiceTeam'),
                df('ServiceProfile'),
                df('ResponseProfile'),
                df('RequestedServiceStartDateTime'),
                df('RequestedServiceEndDateTime')
            ]),
            'ServiceRequest'
        ],
        ['SAP__UI.FieldGroup', fieldGroup('Reference Object', [df('ServiceRefFunctionalLocation'), df('ServiceReferenceEquipment'), df('ReferenceProduct')]), 'ReferenceObject'],
        ['SAP__UI.FieldGroup', fieldGroup('Service Item', [df('ServiceProduct'), df('ServiceDuration')]), 'ServiceItem'],
        ['SAP__UI.FieldGroup', fieldGroup('Service Part', [df('ServicePart'), df('ServicePartQuantity')]), 'PartItem'],
        ['SAP__UI.FieldGroup', fieldGroup('Expected Result', [df('ExpectedNetAmount'), df('NetAmountTolerance')]), 'Expectation'],
        [
            'SAP__common.SideEffects',
            V.rec('SAP__common.SideEffectsType', {
                SourceProperties: V.coll([V.propPath('ServiceReferenceEquipment')]),
                TargetProperties: V.coll(['ReferenceProduct', 'ServiceRefFunctionalLocation'].map(V.str)),
                TargetEntities: V.coll([V.navPath('_ReferenceProduct'), V.navPath('_FunctionalLocation')])
            }),
            'Equipment'
        ],
        [
            'SAP__common.SideEffects',
            V.rec('SAP__common.SideEffectsType', {
                SourceProperties: V.coll([V.propPath('SalesOrganization')]),
                TargetProperties: V.coll(['SalesOrganizationOrgUnitID'].map(V.str))
            }),
            'SalesOrganization'
        ]
    ],
    [`${NS}.ValidationResultType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Validation Finding', 'Validation Findings', 'FieldName', 'ValidationMessage')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('FieldName', undefined, {}, 'High'),
                dfCrit('ValidationStatus', 'Criticality', 'Status', 'High'),
                df('ValidationMessage', undefined, {}, 'High'),
                df('SuggestedValue', undefined, {}, 'High'),
                dfAction('applySuggestion', 'Apply Suggestion', { Inline: V.bool(true) }, [hiddenInDisplayMode, ...importance('High')]),
                df('ProposedValue', undefined, {}, 'Medium'),
                df('BusinessObjectType', undefined, {}, 'Low'),
                df('Category', undefined, {}, 'Low'),
                df('RuleID', undefined, {}, 'Low'),
                df('Source', undefined, {}, 'Low')
            ]),
            undefined,
            [['SAP__UI.Criticality', V.path('Criticality')]]
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ],
    [`${NS}.ExecutionType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Execution', 'Executions', 'ExternalExecutionID', 'Status')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('StartedAt'),
                df('ExternalExecutionID'),
                df('ExecutionProvider'),
                dfCrit('Status', 'StatusCriticality'),
                df('TechnicalResult'),
                dfCrit('FunctionalResult', 'FunctionalResultCriticality'),
                df('FinishedAt'),
                df('DurationInSeconds')
            ]),
            'History'
        ],
        ['SAP__UI.PresentationVariant', sortBy('StartedAt', true)]
    ],
    [`${NS}.ExecutionStepType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Execution Step', 'Execution Steps', 'BusinessObjectType', 'ExecutionStatus')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('Sequence'),
                df('BusinessObjectType'),
                dfCrit('ExecutionStatus', 'Criticality'),
                df('ExpectedStatus'),
                df('ActualStatus'),
                df('StartedAt'),
                df('FinishedAt'),
                df('Message')
            ])
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ],
    [`${NS}.DocumentReferenceType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('SAP Object', 'SAP Objects', 'DocumentID', 'BusinessObjectType')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('Sequence'),
                df('BusinessObjectType'),
                df('DocumentID'),
                df('PredecessorDocumentID'),
                df('LifecycleStatus'),
                df('NetAmount'),
                dfCrit('ValidationStatus', 'Criticality', 'Check')
            ])
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ],
    [`${NS}.TestAssertionType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Test Assertion', 'Test Assertions', 'Field', 'Result')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('BusinessObjectType'),
                df('Field'),
                df('ExpectedValue'),
                df('ActualValue'),
                df('Tolerance'),
                dfCrit('Result', 'Criticality'),
                df('Message')
            ]),
            undefined,
            [['SAP__UI.Criticality', V.path('Criticality')]]
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ],
    [`${NS}.ProcessProfileType`]: [
        ['SAP__common.SemanticKey', V.coll([V.propPath('ProcessProfile')])],
        ['SAP__common.Messages', V.path('SAP__Messages')],
        ['SAP__UI.HeaderInfo', headerInfo('Process Profile', 'Process Profiles', 'ProcessProfileName', 'ProcessProfile')],
        [
            'SAP__UI.LineItem',
            V.coll([df('ProcessProfile'), df('ProcessProfileName'), df('ExecutionProvider'), df('RequiresSecondApprover'), df('IsActive')])
        ],
        ['SAP__UI.SelectionFields', V.coll([V.propPath('ProcessProfile'), V.propPath('ExecutionProvider')])],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('General', [df('ProcessProfile'), df('ProcessProfileName'), df('Description'), df('ExecutionProvider'), df('RequiresSecondApprover'), df('IsActive')]),
            'General'
        ],
        [
            'SAP__UI.Facets',
            V.coll([
                refFacet('General', 'General Information', '@UI.FieldGroup#General'),
                refFacet('FieldRequirements', 'Field Requirements', '_FieldRequirement/@UI.LineItem')
            ])
        ]
    ],
    [`${NS}.FieldRequirementType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Field Requirement', 'Field Requirements', 'FieldName', 'BusinessObject')],
        [
            'SAP__UI.LineItem',
            V.coll([df('Sequence'), df('BusinessObject'), df('FieldName'), df('Required'), df('ValidationRule'), df('DefaultValue'), df('SourceType'), df('Active')])
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ]
};

/* Action annotations: availability via __OperationControl (RAP dynamic feature control) + side effects */
for (const name of testCaseActions) {
    annotations[`${NS}.${name}(${T('TestCase')})`] = [
        ['SAP__core.OperationAvailable', V.path(`_it/__OperationControl/${name}`)],
        ['SAP__common.SideEffects', actionSideEffects[name]]
    ];
}
annotations[`${NS}.applySuggestion(${T('ValidationResult')})`] = [
    ['SAP__core.OperationAvailable', V.path('_it/__OperationControl/applySuggestion')],
    // the suggestion changes the parent test case: test data, status and state messages (path via the partner _TestCase)
    [
        'SAP__common.SideEffects',
        sideEffects(
            validationTargets.map((target) => target.replace('_it/', '_it/_TestCase/')).concat(['_it/_TestCase/ProcessProfile']),
            ['_it/_TestCase/_TestCaseData']
        )
    ]
];
annotations[`${NS}.applySuggestion(${T('ValidationResult')})/SelectedValue`] = [
    ['SAP__common.Label', V.str('Value to Apply')],
    ['SAP__UI.ParameterDefaultValue', V.path('_it/SuggestedValue')]
];

module.exports = {
    NS,
    T,
    entities,
    valueHelps,
    codeLists,
    actions,
    annotations,
    controlledDataFields,
    testCaseActions
};
