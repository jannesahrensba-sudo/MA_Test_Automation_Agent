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
const date = (name, label, opts = {}) => ({ name, type: 'Edm.Date', label, ...opts });
/** fixed-value code list (Code/Text) as value help of a property */
const fixedCodes = (collection) => ({ collection, key: 'Code', display: ['Text'], fixed: true });
/** code property with its text from a code list (text navigation `_<name>` → <collection>) */
const code = (name, maxLength, label, collection, opts = {}) =>
    str(name, maxLength, label, { text: `_${name}/Text`, textArrangement: 'TextOnly', ...(opts.computed ? {} : { valueList: fixedCodes(collection) }), ...opts });
const codeNav = (name, collection) => textNav(`_${name}`, collection, name, 'Code');
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
            str('MaintenancePlant', 4, 'Plant'),
            // hierarchy (structure indicator), e.g. property (Liegenschaft) → usage unit (Nutzeinheit)
            str('SuperiorFunctionalLocation', 40, 'Superior Functional Location')
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
            str('BaseUnit', 3, 'Base Unit'),
            // product group (material group): device type of reference products, spare parts and device-specific services
            str('ProductGroup', 9, 'Product Group')
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
    },
    {
        name: 'ServiceContractVH',
        realBasis: 'A_ServiceContract + A_ServiceContrItemObjectList (API_SERVICE_CONTRACT_SRV)',
        keys: ['ServiceContract'],
        props: [
            str('ServiceContract', 10, 'Service Contract', { text: 'ServiceContractDescription', textArrangement: 'TextFirst' }),
            str('ServiceContractDescription', 40, 'Description'),
            str('SoldToParty', 10, 'Customer'),
            // object list of the contract item: a property (superior functional location) covers all devices below it
            str('ServiceRefFunctionalLocation', 40, 'Covered Functional Location'),
            str('Product', 40, 'Contract Product'),
            date('ServiceContractStartDate', 'Valid From'),
            date('ServiceContractEndDate', 'Valid To'),
            bool('ServiceContractIsReleased', 'Released'),
            str('BillingPlanRule', 40, 'Billing Plan'),
            dec('BillingPlanNetAmount', 15, 2, 'Billing Plan Amount', { currency: 'TransactionCurrency' }),
            str('TransactionCurrency', 5, 'Currency')
        ]
    },
    /* --------------------------- process teams, processes, releases (read models) --------------------------- */
    {
        name: 'ProcessTeamVH',
        realBasis: 'project table of the process teams (target: Responsibility Management team type, to verify)',
        keys: ['ProcessTeam'],
        props: [
            str('ProcessTeam', 20, 'Process Team', { text: 'ProcessTeamName', textArrangement: 'TextFirst' }),
            str('ProcessTeamName', 60, 'Team Name'),
            str('ProcessArea', 40, 'Process Area')
        ]
    },
    {
        // active test cases as predecessors: a test case that starts later in the path takes over their documents
        name: 'TestCaseVH',
        realBasis: 'projection of the active test cases of the project BO (no SAP object)',
        keys: ['CaseID'],
        props: [
            str('CaseID', 20, 'Test Case', { text: 'Title', textArrangement: 'TextFirst' }),
            str('Title', 80, 'Title'),
            str('ProcessTeam', 20, 'Process Team'),
            str('BusinessProcess', 20, 'Process'),
            str('ProcessVariant', 20, 'Process Variant'),
            str('StartObject', 30, 'Start from'),
            str('EndObject', 30, 'Run up to'),
            str('ApprovalStatus', 20, 'Approval'),
            str('LatestResult', 25, 'Latest Result')
        ]
    },
    {
        name: 'UserVH',
        realBasis: 'I_BusinessUserVH (to verify)',
        keys: ['UserID'],
        props: [str('UserID', 12, 'User', { text: 'UserName', textArrangement: 'TextFirst' }), str('UserName', 80, 'Name')]
    },
    {
        name: 'TeamMemberVH',
        realBasis: 'team members and functions (project table; target: Responsibility Management, to verify)',
        keys: ['ProcessTeam', 'UserID', 'TeamRole'],
        props: [
            str('ProcessTeam', 20, 'Process Team'),
            str('UserID', 12, 'User', { text: 'UserName', textArrangement: 'TextFirst' }),
            str('UserName', 80, 'Name'),
            str('TeamRole', 20, 'Role')
        ]
    },
    {
        name: 'BusinessProcessVH',
        realBasis: 'project process catalog (target: SAP Cloud ALM solution process, to verify)',
        keys: ['ProcessID'],
        props: [
            str('ProcessID', 20, 'Process', { text: 'ProcessName', textArrangement: 'TextFirst' }),
            str('ProcessName', 60, 'Process Name'),
            str('OwnerTeam', 20, 'Owner Team'),
            int16('ProcessVersion', 'Version'),
            str('PilotScope', 10, 'Pilot Scope')
        ]
    },
    {
        name: 'ProcessVariantVH',
        realBasis: 'project process catalog: paths through the process flow',
        keys: ['ProcessID', 'Variant'],
        props: [
            str('ProcessID', 20, 'Process'),
            str('Variant', 20, 'Process Variant', { text: 'VariantName', textArrangement: 'TextFirst' }),
            str('VariantName', 80, 'Variant Name'),
            str('PilotScope', 10, 'Pilot Scope'),
            bool('IsDefault', 'Default')
        ]
    },
    {
        name: 'ProcessStepVH',
        realBasis: 'project process catalog: process steps (target: SAP Cloud ALM process steps, to verify)',
        keys: ['ProcessID', 'StepID'],
        props: [
            str('ProcessID', 20, 'Process'),
            str('StepID', 20, 'Process Step', { text: 'StepName', textArrangement: 'TextFirst' }),
            str('StepName', 80, 'Step Name'),
            int16('Sequence', 'Sequence'),
            str('BusinessObjectType', 30, 'Business Object'),
            str('ResponsibleTeam', 20, 'Responsible Team'),
            str('TeamAssignment', 10, 'Team Assignment'),
            str('Variants', 120, 'Variants'),
            str('PilotScope', 10, 'Pilot Scope'),
            str('Automation', 10, 'Automation')
        ]
    },
    {
        name: 'ReleaseVH',
        realBasis: 'project release calendar (target: SAP Cloud ALM release/timebox, to verify)',
        keys: ['ReleaseID'],
        props: [
            str('ReleaseID', 20, 'Release', { text: 'ReleaseName', textArrangement: 'TextFirst' }),
            str('ReleaseName', 60, 'Release Name'),
            str('ReleaseType', 20, 'Release Type'),
            str('ReleaseStatus', 20, 'Status'),
            date('TestStartDate', 'Test Start'),
            date('TestEndDate', 'Test End')
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
    ['ExecutionProviderVH', 'Execution Provider', 60],
    // process teams, processes and releases
    ['TeamRoleVH', 'Team Role', 40],
    ['AssignmentStatusVH', 'Assignment', 30],
    ['PilotScopeVH', 'Pilot Scope', 30],
    ['AutomationVH', 'Automation', 40],
    ['ReleaseTypeVH', 'Release Type', 40],
    ['ReleaseStatusVH', 'Release Status', 20],
    ['TestLevelVH', 'Test Level', 40],
    ['RunTypeVH', 'Run Type', 30],
    ['CoverageStatusVH', 'Coverage', 30],
    ['RunDecisionVH', 'Decision', 20],
    ['EndObjectVH', 'End Object', 40],
    ['DocumentOriginVH', 'Document Origin', 40]
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
    'ServiceContract',
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

/** Actions of the release: regression run over the release scope and scope takeover from the predecessor release */
const releaseActions = ['startRegressionRun', 'refreshRegressionRun', 'copyScopeFromPredecessor'];

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
            guid('LatestExecutionUUID', 'Latest Execution', { computed: true, hidden: true }),
            // process reference: process team → business process → process variant (path) → process steps → test steps
            str('ProcessTeam', 20, 'Process Team', {
                text: '_ProcessTeam/ProcessTeamName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ProcessTeamVH', key: 'ProcessTeam', display: ['ProcessTeamName', 'ProcessArea'] }
            }),
            str('BusinessProcess', 20, 'Business Process', {
                text: '_BusinessProcess/ProcessName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'BusinessProcessVH', key: 'ProcessID', display: ['ProcessName', 'OwnerTeam', 'ProcessVersion', 'PilotScope'] }
            }),
            str('ProcessVariant', 20, 'Process Variant', {
                text: '_ProcessVariant/VariantName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ProcessVariantVH', key: 'Variant', display: ['VariantName', 'PilotScope'], in: [['BusinessProcess', 'ProcessID']] }
            }),
            code('EndObject', 30, 'Run up to', 'EndObjectVH'),
            // start of the run: by default where the process team enters the path (e.g. the quotation for the quotation team)
            code('StartObject', 30, 'Start from', 'EndObjectVH'),
            // a start without an own predecessor document (e.g. billing) takes the documents of a predecessor test case over
            str('PredecessorTestCase', 20, 'Predecessor Test Case', {
                text: '_PredecessorTestCase/Title',
                textArrangement: 'TextLast',
                valueList: {
                    collection: 'TestCaseVH',
                    key: 'CaseID',
                    display: ['Title', 'ProcessTeam', 'ProcessVariant', 'StartObject', 'EndObject', 'ApprovalStatus', 'LatestResult'],
                    in: [['BusinessProcess', 'BusinessProcess']]
                }
            }),
            code('PredecessorObject', 30, 'Takes Over', 'EndObjectVH', { computed: true }),
            // derived from the section of the path (handover to another team → E2E), never entered
            code('TestLevel', 20, 'Test Level', 'TestLevelVH', { computed: true }),
            str('BusinessOwner', 12, 'Business Owner', {
                text: '_BusinessOwner/UserName',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'TeamMemberVH',
                    key: 'UserID',
                    display: ['UserName'],
                    in: [['ProcessTeam', 'ProcessTeam']],
                    constants: [['TeamRole', 'PROCESS_OWNER']]
                }
            }),
            str('Preconditions', 1000, 'Preconditions', { multiLine: true }),
            str('ExternalTestCaseID', 40, 'External Test Case ID'),
            int16('ProcessVersion', 'Process Version', { computed: true }),
            code('AssignmentStatus', 10, 'Process Assignment', 'AssignmentStatusVH', { computed: true }),
            crit('AssignmentCriticality'),
            str('AssignmentNote', 255, 'Assignment Note', { computed: true }),
            // versioned test case: every saved change creates a new version; an approval is valid for one version only
            int16('Version', 'Version', { computed: true }),
            int16('ApprovedVersion', 'Approved Version', { computed: true }),
            str('ContentHash', 64, 'Content Hash', { computed: true, hidden: true })
        ],
        navs: [
            { name: '_TestCaseData', target: 'TestCaseData', partner: '_TestCase', constraints: [['TestCaseUUID', 'TestCaseUUID']], cascade: true },
            { name: '_Step', target: 'TestCaseStep', collection: true, partner: '_TestCase', constraints: [['TestCaseUUID', 'TestCaseUUID']], cascade: true },
            { name: '_Version', target: 'TestCaseVersion', collection: true, constraints: [['TestCaseUUID', 'TestCaseUUID']] },
            textNav('_ProcessTeam', 'ProcessTeamVH', 'ProcessTeam', 'ProcessTeam'),
            textNav('_BusinessProcess', 'BusinessProcessVH', 'BusinessProcess', 'ProcessID'),
            {
                name: '_ProcessVariant',
                target: 'ProcessVariantVH',
                constraints: [
                    ['BusinessProcess', 'ProcessID'],
                    ['ProcessVariant', 'Variant']
                ]
            },
            codeNav('EndObject', 'EndObjectVH'),
            codeNav('StartObject', 'EndObjectVH'),
            codeNav('PredecessorObject', 'EndObjectVH'),
            textNav('_PredecessorTestCase', 'TestCaseVH', 'PredecessorTestCase', 'CaseID'),
            codeNav('TestLevel', 'TestLevelVH'),
            textNav('_BusinessOwner', 'UserVH', 'BusinessOwner', 'UserID'),
            codeNav('AssignmentStatus', 'AssignmentStatusVH'),
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
                    display: ['FunctionalLocationName', 'SuperiorFunctionalLocation', 'MaintenancePlant'],
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
                valueList: { collection: 'ProductVH', key: 'Product', display: ['ProductDescription', 'ProductGroup'], constants: [['ProductType', 'FERT']] }
            }),
            // Service contract (A_ServiceOrder.ReferenceServiceContract): contract determination of variant "service from a contract"
            str('ServiceContract', 10, 'Service Contract', {
                text: '_ServiceContract/ServiceContractDescription',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'ServiceContractVH',
                    key: 'ServiceContract',
                    display: ['ServiceContractDescription', 'ServiceRefFunctionalLocation', 'ServiceContractEndDate', 'ServiceContractIsReleased'],
                    in: [['SoldToParty', 'SoldToParty']]
                }
            }),
            // Service order items (A_ServiceOrderItem)
            str('ServiceProduct', 40, 'Service Product', {
                text: '_ServiceProduct/ProductDescription',
                textArrangement: 'TextFirst',
                valueList: {
                    collection: 'ProductVH',
                    key: 'Product',
                    display: ['ProductDescription', 'ProductGroup', 'BaseUnit'],
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
                    display: ['ProductDescription', 'ProductGroup', 'BaseUnit'],
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
            textNav('_ServiceContract', 'ServiceContractVH', 'ServiceContract', 'ServiceContract'),
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
            longText('TechnicalLog', 'Technical Log', { computed: true }),
            // traceability: release, versions and process path of the run
            str('ReleaseID', 20, 'Release', { computed: true, text: '_Release/ReleaseName', textArrangement: 'TextFirst' }),
            int16('TestCaseVersion', 'Test Case Version', { computed: true }),
            str('ProcessID', 20, 'Process', { computed: true }),
            int16('ProcessVersion', 'Process Version', { computed: true }),
            str('ProcessVariant', 20, 'Process Variant', { computed: true }),
            code('EndObject', 30, 'Run up to', 'EndObjectVH', { computed: true }),
            code('StartObject', 30, 'Start from', 'EndObjectVH', { computed: true }),
            str('PredecessorExecution', 60, 'Taken Over From', { computed: true }),
            code('RunType', 20, 'Run Type', 'RunTypeVH', { computed: true }),
            guid('RegressionRunUUID', 'Regression Run', { computed: true, hidden: true }),
            str('ExecutedBy', 12, 'Executed By', { computed: true })
        ],
        navs: [
            { name: '_TestCase', target: 'TestCase', partner: '_Execution', nullable: false, constraints: [['TestCaseUUID', 'TestCaseUUID']] },
            textNav('_Release', 'ReleaseVH', 'ReleaseID', 'ReleaseID'),
            codeNav('EndObject', 'EndObjectVH'),
            codeNav('StartObject', 'EndObjectVH'),
            codeNav('RunType', 'RunTypeVH'),
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
            str('Message', 255, 'Message', { computed: true }),
            str('ProcessStepID', 20, 'Process Step', { computed: true, text: 'StepName', textArrangement: 'TextFirst' }),
            str('StepName', 80, 'Process Step Name', { computed: true }),
            str('ResponsibleTeam', 20, 'Responsible Team', { computed: true, text: '_ResponsibleTeam/ProcessTeamName', textArrangement: 'TextFirst' })
        ],
        navs: [
            { name: '_Execution', target: 'Execution', partner: '_ExecutionStep', nullable: false, constraints: [['ExecutionUUID', 'ExecutionUUID']] },
            textNav('_ResponsibleTeam', 'ProcessTeamVH', 'ResponsibleTeam', 'ProcessTeam'),
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
            crit('Criticality'),
            str('ProcessStepID', 20, 'Process Step', { computed: true, text: 'StepName', textArrangement: 'TextFirst' }),
            str('StepName', 80, 'Process Step Name', { computed: true }),
            // created by this run, determined (existing contract) or taken over from the run of a predecessor test case
            code('DocumentOrigin', 20, 'Origin', 'DocumentOriginVH', { computed: true }),
            str('OriginReference', 60, 'Taken Over From', { computed: true })
        ],
        navs: [
            { name: '_Execution', target: 'Execution', partner: '_DocumentReference', nullable: false, constraints: [['ExecutionUUID', 'ExecutionUUID']] },
            codeNav('DocumentOrigin', 'DocumentOriginVH'),
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
            str('Message', 255, 'Message', { computed: true }),
            str('ProcessStepID', 20, 'Process Step', { computed: true, text: 'StepName', textArrangement: 'TextFirst' }),
            str('StepName', 80, 'Process Step Name', { computed: true })
        ],
        navs: [
            { name: '_Execution', target: 'Execution', partner: '_TestAssertion', nullable: false, constraints: [['ExecutionUUID', 'ExecutionUUID']] },
            textNav('_BusinessObjectType', 'BusinessObjectTypeVH', 'BusinessObjectType', 'Code'),
            textNav('_Result', 'AssertionResultVH', 'Result', 'Code')
        ]
    },
    /* ------------------------------ TestCaseStep (test steps derived from the process variant) ------------------------------ */
    {
        name: 'TestCaseStep',
        draft: 'node',
        keys: ['TestCaseStepUUID'],
        props: [
            guid('TestCaseStepUUID', 'Test Step UUID', { nullable: false, computed: true, hidden: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            int16('StepNo', 'Step'),
            str('ProcessID', 20, 'Process', { computed: true, hidden: true }),
            str('ProcessStepID', 20, 'Process Step', {
                text: 'StepName',
                textArrangement: 'TextFirst',
                // the process of the test case is a hidden technical field: the value help lists the steps of all processes
                valueList: {
                    collection: 'ProcessStepVH',
                    key: 'StepID',
                    display: ['StepName', 'ProcessID', 'BusinessObjectType', 'ResponsibleTeam', 'Variants']
                }
            }),
            str('StepName', 80, 'Process Step Name', { computed: true }),
            code('BusinessObjectType', 30, 'Business Object', 'BusinessObjectTypeVH', { computed: true }),
            str('Action', 255, 'Action / Instruction'),
            str('ExpectedResult', 255, 'Expected Result'),
            str('ResponsibleTeam', 20, 'Responsible Team', { computed: true, text: '_ResponsibleTeam/ProcessTeamName', textArrangement: 'TextFirst' }),
            code('TeamAssignment', 10, 'Team Assignment', 'AssignmentStatusVH', { computed: true }),
            crit('TeamAssignmentCriticality'),
            bool('IsHandover', 'Handover', { computed: true }),
            code('Automation', 10, 'Automation', 'AutomationVH', { computed: true }),
            code('StepSource', 20, 'Source', 'SourceTypeVH', { computed: true })
        ],
        navs: [
            { name: '_TestCase', target: 'TestCase', partner: '_Step', nullable: false, constraints: [['TestCaseUUID', 'TestCaseUUID']] },
            codeNav('BusinessObjectType', 'BusinessObjectTypeVH'),
            textNav('_ResponsibleTeam', 'ProcessTeamVH', 'ResponsibleTeam', 'ProcessTeam'),
            codeNav('TeamAssignment', 'AssignmentStatusVH'),
            codeNav('Automation', 'AutomationVH'),
            codeNav('StepSource', 'SourceTypeVH')
        ]
    },
    /* ------------------------------ TestCaseVersion (version history, read-only) ------------------------------ */
    {
        name: 'TestCaseVersion',
        keys: ['TestCaseVersionUUID'],
        props: [
            guid('TestCaseVersionUUID', 'Version UUID', { nullable: false, computed: true, hidden: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            str('CaseID', 20, 'Case ID', { computed: true }),
            int16('Version', 'Version', { computed: true }),
            dto('ActivatedAt', 'Saved At', { computed: true }),
            str('ActivatedBy', 12, 'Saved By', { computed: true }),
            str('ChangeSummary', 255, 'Changes', { computed: true }),
            str('ProcessID', 20, 'Process', { computed: true }),
            int16('ProcessVersion', 'Process Version', { computed: true }),
            str('ProcessVariant', 20, 'Process Variant', { computed: true }),
            code('ApprovalStatus', 20, 'Approval', 'ApprovalStatusVH', { computed: true }),
            crit('ApprovalCriticality'),
            str('ApprovedBy', 12, 'Approved By', { computed: true }),
            dto('ApprovedAt', 'Approved At', { computed: true }),
            str('ContentHash', 64, 'Content Hash', { computed: true, hidden: true }),
            longText('Snapshot', 'Snapshot', { computed: true, hidden: true })
        ],
        navs: [codeNav('ApprovalStatus', 'ApprovalStatusVH')]
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
    },
    /* ------------------------------ BO 3: Process team (draft root) ------------------------------ */
    {
        name: 'ProcessTeam',
        draft: 'root',
        keys: ['ProcessTeam'],
        messages: true,
        entityControl: true,
        props: [
            str('ProcessTeam', 20, 'Process Team', { nullable: false, immutable: true }),
            str('ProcessTeamName', 60, 'Team Name'),
            str('ProcessArea', 40, 'Process Area'),
            str('Description', 1000, 'Description', { multiLine: true }),
            bool('IsActive', 'Active'),
            int16('ProcessOwnerCount', 'Process Owners', { computed: true }),
            int16('TestExecutorCount', 'Test Executors', { computed: true }),
            int16('ResponsibleStepCount', 'Responsible Steps', { computed: true }),
            int16('TestCaseCount', 'Test Cases', { computed: true }),
            int16('OpenAssignmentCount', 'Open Step Assignments', { computed: true })
        ],
        navs: [
            { name: '_Member', target: 'TeamMember', collection: true, partner: '_ProcessTeam', constraints: [['ProcessTeam', 'ProcessTeam']], cascade: true },
            { name: '_ResponsibleStep', target: 'ProcessStepVH', collection: true, constraints: [['ProcessTeam', 'ResponsibleTeam']] },
            { name: '_OwnedProcess', target: 'BusinessProcessVH', collection: true, constraints: [['ProcessTeam', 'OwnerTeam']] }
        ]
    },
    {
        name: 'TeamMember',
        draft: 'node',
        keys: ['MemberUUID'],
        props: [
            guid('MemberUUID', 'Member UUID', { nullable: false, computed: true, hidden: true }),
            str('ProcessTeam', 20, 'Process Team', { computed: true, hidden: true }),
            str('UserID', 12, 'User', {
                text: '_User/UserName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'UserVH', key: 'UserID', display: ['UserName'] }
            }),
            code('TeamRole', 20, 'Role', 'TeamRoleVH'),
            str('Note', 120, 'Note')
        ],
        navs: [
            { name: '_ProcessTeam', target: 'ProcessTeam', partner: '_Member', nullable: false, constraints: [['ProcessTeam', 'ProcessTeam']] },
            textNav('_User', 'UserVH', 'UserID', 'UserID'),
            codeNav('TeamRole', 'TeamRoleVH')
        ]
    },
    /* ------------------------------ BO 4: Business process (draft root, versioned) ------------------------------ */
    {
        name: 'BusinessProcess',
        draft: 'root',
        keys: ['ProcessID'],
        messages: true,
        entityControl: true,
        props: [
            str('ProcessID', 20, 'Process', { nullable: false, immutable: true }),
            str('ProcessName', 60, 'Process Name'),
            str('Description', 1000, 'Description', { multiLine: true }),
            str('ProcessArea', 40, 'Process Area'),
            str('OwnerTeam', 20, 'Owner Team', {
                text: '_OwnerTeam/ProcessTeamName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ProcessTeamVH', key: 'ProcessTeam', display: ['ProcessTeamName'] }
            }),
            code('PilotScope', 10, 'Pilot Scope', 'PilotScopeVH'),
            str('SAPReference', 255, 'SAP Reference', { multiLine: true }),
            int16('ProcessVersion', 'Version', { computed: true }),
            str('VersionNote', 255, 'Change Note'),
            dto('VersionActivatedAt', 'Version Since', { computed: true }),
            str('VersionActivatedBy', 12, 'Version By', { computed: true }),
            code('ModelingStatus', 10, 'Process Model', 'AssignmentStatusVH', { computed: true }),
            crit('ModelingCriticality'),
            int16('StepCount', 'Steps', { computed: true }),
            int16('VariantCount', 'Variants', { computed: true }),
            int16('TestCaseCount', 'Test Cases', { computed: true }),
            str('ContentHash', 64, 'Content Hash', { computed: true, hidden: true })
        ],
        navs: [
            { name: '_Step', target: 'ProcessStep', collection: true, partner: '_Process', constraints: [['ProcessID', 'ProcessID']], cascade: true },
            { name: '_Variant', target: 'ProcessVariant', collection: true, partner: '_Process', constraints: [['ProcessID', 'ProcessID']], cascade: true },
            { name: '_Version', target: 'ProcessVersion', collection: true, constraints: [['ProcessID', 'ProcessID']] },
            textNav('_OwnerTeam', 'ProcessTeamVH', 'OwnerTeam', 'ProcessTeam'),
            codeNav('PilotScope', 'PilotScopeVH'),
            codeNav('ModelingStatus', 'AssignmentStatusVH')
        ]
    },
    {
        name: 'ProcessStep',
        draft: 'node',
        keys: ['ProcessStepUUID'],
        props: [
            guid('ProcessStepUUID', 'Process Step UUID', { nullable: false, computed: true, hidden: true }),
            str('ProcessID', 20, 'Process', { computed: true, hidden: true }),
            int16('Sequence', 'Sequence'),
            str('StepID', 20, 'Step ID'),
            str('StepName', 80, 'Process Step'),
            code('BusinessObjectType', 30, 'Business Object', 'BusinessObjectTypeVH'),
            str('ExpectedStatus', 30, 'Expected Status'),
            str('ResponsibleTeam', 20, 'Responsible Team', {
                text: '_ResponsibleTeam/ProcessTeamName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ProcessTeamVH', key: 'ProcessTeam', display: ['ProcessTeamName'] }
            }),
            code('TeamAssignment', 10, 'Team Assignment', 'AssignmentStatusVH'),
            crit('TeamAssignmentCriticality'),
            str('Variants', 120, 'Variants'),
            code('PilotScope', 10, 'Pilot Scope', 'PilotScopeVH'),
            code('Automation', 10, 'Automation', 'AutomationVH'),
            bool('IsHandover', 'Handover', { computed: true }),
            str('TestAction', 255, 'Test Action (template)'),
            str('TestExpectedResult', 255, 'Expected Result (template)'),
            str('SAPReference', 120, 'SAP Reference'),
            str('Note', 255, 'Note'),
            int16('TestCaseCount', 'Test Cases', { computed: true })
        ],
        navs: [
            { name: '_Process', target: 'BusinessProcess', partner: '_Step', nullable: false, constraints: [['ProcessID', 'ProcessID']] },
            codeNav('BusinessObjectType', 'BusinessObjectTypeVH'),
            textNav('_ResponsibleTeam', 'ProcessTeamVH', 'ResponsibleTeam', 'ProcessTeam'),
            codeNav('TeamAssignment', 'AssignmentStatusVH'),
            codeNav('PilotScope', 'PilotScopeVH'),
            codeNav('Automation', 'AutomationVH')
        ]
    },
    {
        name: 'ProcessVariant',
        draft: 'node',
        keys: ['VariantUUID'],
        props: [
            guid('VariantUUID', 'Variant UUID', { nullable: false, computed: true, hidden: true }),
            str('ProcessID', 20, 'Process', { computed: true, hidden: true }),
            int16('Sequence', 'Sequence'),
            str('Variant', 20, 'Variant'),
            str('VariantName', 80, 'Variant Name'),
            str('Description', 255, 'Description', { multiLine: true }),
            code('PilotScope', 10, 'Pilot Scope', 'PilotScopeVH'),
            bool('IsDefault', 'Default Variant'),
            str('StepPath', 255, 'Step Path', { computed: true }),
            str('DocumentPath', 120, 'Document Chain', { computed: true }),
            int16('TestCaseCount', 'Test Cases', { computed: true })
        ],
        navs: [
            { name: '_Process', target: 'BusinessProcess', partner: '_Variant', nullable: false, constraints: [['ProcessID', 'ProcessID']] },
            codeNav('PilotScope', 'PilotScopeVH')
        ]
    },
    {
        name: 'ProcessVersion',
        keys: ['ProcessVersionUUID'],
        props: [
            guid('ProcessVersionUUID', 'Process Version UUID', { nullable: false, computed: true, hidden: true }),
            str('ProcessID', 20, 'Process', { computed: true }),
            int16('ProcessVersion', 'Version', { computed: true }),
            dto('ActivatedAt', 'Activated At', { computed: true }),
            str('ActivatedBy', 12, 'Activated By', { computed: true }),
            str('VersionNote', 255, 'Change Note', { computed: true }),
            int16('StepCount', 'Steps', { computed: true }),
            int16('VariantCount', 'Variants', { computed: true }),
            str('ContentHash', 64, 'Content Hash', { computed: true, hidden: true })
        ],
        navs: []
    },
    /* ------------------------------ BO 5: Release (draft root) with the scope link table ------------------------------ */
    {
        name: 'Release',
        draft: 'root',
        keys: ['ReleaseID'],
        messages: true,
        entityControl: true,
        operationControl: releaseActions,
        props: [
            str('ReleaseID', 20, 'Release', { nullable: false, immutable: true }),
            str('ReleaseName', 60, 'Release Name'),
            code('ReleaseType', 20, 'Release Type', 'ReleaseTypeVH'),
            str('SAPProductVersion', 40, 'SAP Product Version'),
            str('FeaturePackStack', 10, 'FPS / SPS'),
            code('ReleaseStatus', 20, 'Release Status', 'ReleaseStatusVH'),
            crit('ReleaseStatusCriticality'),
            date('SAPAvailabilityDate', 'SAP Availability (planned)'),
            date('TestStartDate', 'Test Start'),
            date('TestEndDate', 'Test End'),
            date('GoLiveDate', 'Go-Live'),
            str('PredecessorRelease', 20, 'Predecessor Release', {
                text: '_PredecessorRelease/ReleaseName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ReleaseVH', key: 'ReleaseID', display: ['ReleaseName', 'ReleaseStatus'] }
            }),
            bool('AutoRegression', 'Regression at Test Start'),
            str('Description', 1000, 'Description', { multiLine: true }),
            str('SourceNote', 255, 'Source of Dates', { multiLine: true }),
            int16('ScopeCount', 'Scope Entries', { computed: true }),
            int16('TestCaseCount', 'Test Cases in Scope', { computed: true }),
            int16('ApprovedCount', 'Approved', { computed: true }),
            int16('ExecutedCount', 'Executed', { computed: true }),
            int16('PassedCount', 'Passed', { computed: true }),
            int16('FailedCount', 'Failed', { computed: true }),
            int16('PassRate', 'Pass Rate', { computed: true, unitText: '%' }),
            crit('PassRateCriticality'),
            int16('StepCoverage', 'Step Coverage', { computed: true, unitText: '%' }),
            crit('StepCoverageCriticality'),
            guid('LatestRunUUID', 'Latest Regression Run', { computed: true, hidden: true }),
            str('LatestRunID', 30, 'Latest Regression Run', { computed: true }),
            code('LatestRunStatus', 20, 'Run Status', 'ExecutionStatusVH', { computed: true }),
            crit('LatestRunCriticality'),
            dto('LatestRunAt', 'Run Started', { computed: true })
        ],
        navs: [
            { name: '_Scope', target: 'ReleaseScope', collection: true, partner: '_Release', constraints: [['ReleaseID', 'ReleaseID']], cascade: true },
            { name: '_TestCase', target: 'ReleaseTestCase', collection: true, constraints: [['ReleaseID', 'ReleaseID']] },
            { name: '_StepCoverage', target: 'ReleaseStepCoverage', collection: true, constraints: [['ReleaseID', 'ReleaseID']] },
            { name: '_RegressionRun', target: 'RegressionRun', collection: true, constraints: [['ReleaseID', 'ReleaseID']] },
            { name: '_LatestRunItem', target: 'RegressionRunItem', collection: true, constraints: [['LatestRunUUID', 'RunUUID']] },
            codeNav('ReleaseType', 'ReleaseTypeVH'),
            codeNav('ReleaseStatus', 'ReleaseStatusVH'),
            textNav('_PredecessorRelease', 'ReleaseVH', 'PredecessorRelease', 'ReleaseID'),
            codeNav('LatestRunStatus', 'ExecutionStatusVH')
        ]
    },
    {
        // link table ("Zwischentabelle"): release × process team × business process (version)
        name: 'ReleaseScope',
        draft: 'node',
        keys: ['ScopeUUID'],
        props: [
            guid('ScopeUUID', 'Scope UUID', { nullable: false, computed: true, hidden: true }),
            str('ReleaseID', 20, 'Release', { computed: true, hidden: true }),
            str('ProcessTeam', 20, 'Process Team', {
                text: '_ProcessTeam/ProcessTeamName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'ProcessTeamVH', key: 'ProcessTeam', display: ['ProcessTeamName', 'ProcessArea'] }
            }),
            str('ProcessID', 20, 'Process', {
                text: '_Process/ProcessName',
                textArrangement: 'TextFirst',
                valueList: { collection: 'BusinessProcessVH', key: 'ProcessID', display: ['ProcessName', 'OwnerTeam', 'ProcessVersion', 'PilotScope'] }
            }),
            int16('ProcessVersion', 'Process Version'),
            bool('IsRegressionRelevant', 'In Regression'),
            str('ScopeNote', 255, 'Note'),
            int16('TestCaseCount', 'Test Cases', { computed: true }),
            int16('ApprovedCount', 'Approved', { computed: true }),
            int16('ExecutedCount', 'Executed', { computed: true }),
            int16('PassedCount', 'Passed', { computed: true }),
            int16('FailedCount', 'Failed', { computed: true }),
            int16('PassRate', 'Pass Rate', { computed: true, unitText: '%' }),
            int16('StepCoverage', 'Step Coverage', { computed: true, unitText: '%' }),
            code('ScopeStatus', 20, 'Test Status', 'CoverageStatusVH', { computed: true }),
            crit('ScopeStatusCriticality')
        ],
        navs: [
            { name: '_Release', target: 'Release', partner: '_Scope', nullable: false, constraints: [['ReleaseID', 'ReleaseID']] },
            textNav('_ProcessTeam', 'ProcessTeamVH', 'ProcessTeam', 'ProcessTeam'),
            textNav('_Process', 'BusinessProcessVH', 'ProcessID', 'ProcessID'),
            codeNav('ScopeStatus', 'CoverageStatusVH')
        ]
    },
    {
        // read model: test cases of the release scope with their result in this release
        name: 'ReleaseTestCase',
        keys: ['ReleaseTestCaseUUID'],
        props: [
            guid('ReleaseTestCaseUUID', 'Release Test Case UUID', { nullable: false, computed: true, hidden: true }),
            str('ReleaseID', 20, 'Release', { computed: true, hidden: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            str('CaseID', 20, 'Case ID', { computed: true }),
            str('Title', 80, 'Title', { computed: true }),
            str('ProcessTeam', 20, 'Process Team', { computed: true, text: '_ProcessTeam/ProcessTeamName', textArrangement: 'TextFirst' }),
            str('ProcessID', 20, 'Process', { computed: true, text: '_Process/ProcessName', textArrangement: 'TextFirst' }),
            str('ProcessVariant', 20, 'Process Variant', { computed: true, text: 'VariantName', textArrangement: 'TextFirst' }),
            str('VariantName', 80, 'Variant Name', { computed: true }),
            code('TestLevel', 20, 'Test Level', 'TestLevelVH', { computed: true }),
            code('EndObject', 30, 'Run up to', 'EndObjectVH', { computed: true }),
            int16('TestCaseVersion', 'Version', { computed: true }),
            int16('ApprovedVersion', 'Approved Version', { computed: true }),
            code('ApprovalStatus', 20, 'Approval', 'ApprovalStatusVH', { computed: true }),
            crit('ApprovalCriticality'),
            bool('IsRegressionRelevant', 'In Regression', { computed: true }),
            code('ResultInRelease', 25, 'Result in Release', 'FinalResultVH', { computed: true }),
            crit('ResultCriticality'),
            str('ExternalExecutionID', 40, 'Latest Run', { computed: true }),
            int16('ExecutedVersion', 'Executed Version', { computed: true }),
            dto('ExecutedAt', 'Executed At', { computed: true }),
            str('ExecutedBy', 12, 'Executed By', { computed: true }),
            code('RunType', 20, 'Run Type', 'RunTypeVH', { computed: true }),
            str('Remark', 255, 'Remark', { computed: true })
        ],
        navs: [
            textNav('_ProcessTeam', 'ProcessTeamVH', 'ProcessTeam', 'ProcessTeam'),
            textNav('_Process', 'BusinessProcessVH', 'ProcessID', 'ProcessID'),
            codeNav('TestLevel', 'TestLevelVH'),
            codeNav('EndObject', 'EndObjectVH'),
            codeNav('ApprovalStatus', 'ApprovalStatusVH'),
            codeNav('ResultInRelease', 'FinalResultVH'),
            codeNav('RunType', 'RunTypeVH')
        ]
    },
    {
        // read model: coverage of each process step in the release (design and execution)
        name: 'ReleaseStepCoverage',
        keys: ['CoverageUUID'],
        props: [
            guid('CoverageUUID', 'Coverage UUID', { nullable: false, computed: true, hidden: true }),
            str('ReleaseID', 20, 'Release', { computed: true, hidden: true }),
            str('ProcessID', 20, 'Process', { computed: true, text: '_Process/ProcessName', textArrangement: 'TextFirst' }),
            int16('Sequence', 'Sequence', { computed: true }),
            str('StepID', 20, 'Step ID', { computed: true }),
            str('StepName', 80, 'Process Step', { computed: true }),
            code('BusinessObjectType', 30, 'Business Object', 'BusinessObjectTypeVH', { computed: true }),
            str('ResponsibleTeam', 20, 'Responsible Team', { computed: true, text: '_ResponsibleTeam/ProcessTeamName', textArrangement: 'TextFirst' }),
            code('TeamAssignment', 10, 'Team Assignment', 'AssignmentStatusVH', { computed: true }),
            bool('IsHandover', 'Handover', { computed: true }),
            code('Automation', 10, 'Automation', 'AutomationVH', { computed: true }),
            int16('TestCaseCount', 'Test Cases', { computed: true }),
            int16('ExecutedCount', 'Executed', { computed: true }),
            int16('PassedCount', 'Passed', { computed: true }),
            int16('FailedCount', 'Failed', { computed: true }),
            code('CoverageStatus', 20, 'Coverage', 'CoverageStatusVH', { computed: true }),
            crit('CoverageCriticality'),
            str('LatestDocumentID', 20, 'Latest Document', { computed: true }),
            str('Remark', 255, 'Remark', { computed: true })
        ],
        navs: [
            textNav('_Process', 'BusinessProcessVH', 'ProcessID', 'ProcessID'),
            codeNav('BusinessObjectType', 'BusinessObjectTypeVH'),
            textNav('_ResponsibleTeam', 'ProcessTeamVH', 'ResponsibleTeam', 'ProcessTeam'),
            codeNav('TeamAssignment', 'AssignmentStatusVH'),
            codeNav('Automation', 'AutomationVH'),
            codeNav('CoverageStatus', 'CoverageStatusVH')
        ]
    },
    {
        name: 'RegressionRun',
        keys: ['RunUUID'],
        props: [
            guid('RunUUID', 'Run UUID', { nullable: false, computed: true, hidden: true }),
            str('RunID', 30, 'Regression Run', { computed: true }),
            str('ReleaseID', 20, 'Release', { computed: true, hidden: true }),
            code('Status', 20, 'Status', 'ExecutionStatusVH', { computed: true }),
            crit('StatusCriticality'),
            str('Trigger', 30, 'Trigger', { computed: true }),
            dto('StartedAt', 'Started At', { computed: true }),
            str('StartedBy', 12, 'Started By', { computed: true }),
            dto('FinishedAt', 'Finished At', { computed: true }),
            int16('CandidateCount', 'Test Cases', { computed: true }),
            int16('StartedCount', 'Started', { computed: true }),
            int16('SkippedCount', 'Skipped', { computed: true }),
            int16('RunningCount', 'Running', { computed: true }),
            int16('PassedCount', 'Passed', { computed: true }),
            int16('FailedCount', 'Failed', { computed: true }),
            int16('PassRate', 'Pass Rate', { computed: true, unitText: '%' }),
            crit('PassRateCriticality')
        ],
        navs: [
            { name: '_Item', target: 'RegressionRunItem', collection: true, constraints: [['RunUUID', 'RunUUID']] },
            codeNav('Status', 'ExecutionStatusVH')
        ]
    },
    {
        name: 'RegressionRunItem',
        keys: ['RunItemUUID'],
        props: [
            guid('RunItemUUID', 'Run Item UUID', { nullable: false, computed: true, hidden: true }),
            guid('RunUUID', 'Run UUID', { computed: true, hidden: true }),
            int16('Sequence', 'No.', { computed: true }),
            guid('TestCaseUUID', 'Test Case UUID', { computed: true, hidden: true }),
            str('CaseID', 20, 'Case ID', { computed: true }),
            str('Title', 80, 'Title', { computed: true }),
            str('ProcessTeam', 20, 'Process Team', { computed: true, text: '_ProcessTeam/ProcessTeamName', textArrangement: 'TextFirst' }),
            str('ProcessVariant', 20, 'Process Variant', { computed: true }),
            int16('TestCaseVersion', 'Version', { computed: true }),
            code('Decision', 20, 'Decision', 'RunDecisionVH', { computed: true }),
            crit('DecisionCriticality'),
            str('Reason', 255, 'Reason', { computed: true }),
            guid('ExecutionUUID', 'Execution UUID', { computed: true, hidden: true }),
            str('ExternalExecutionID', 40, 'Execution', { computed: true }),
            code('ExecutionStatus', 20, 'Execution Status', 'ExecutionStatusVH', { computed: true }),
            code('FinalResult', 25, 'Result', 'FinalResultVH', { computed: true }),
            crit('ResultCriticality')
        ],
        navs: [
            textNav('_ProcessTeam', 'ProcessTeamVH', 'ProcessTeam', 'ProcessTeam'),
            codeNav('Decision', 'RunDecisionVH'),
            codeNav('ExecutionStatus', 'ExecutionStatusVH'),
            codeNav('FinalResult', 'FinalResultVH')
        ]
    }
];

/* ------------------------------------------------------------------------------------------------ */
/* Actions                                                                                           */
/* ------------------------------------------------------------------------------------------------ */
const actions = [
    ...testCaseActions.map((name) => ({ name, boundTo: 'TestCase', returns: 'TestCase' })),
    ...releaseActions.map((name) => ({ name, boundTo: 'Release', returns: 'Release' })),
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
/** percentage KPI (0..100) shown as progress indicator in headers and tables */
const progressPoint = (value, title, criticalityPath) =>
    V.rec(`${UI}.DataPointType`, {
        Value: V.path(value),
        Title: V.str(title),
        TargetValue: V.int(100),
        Visualization: V.enum(`${UI}.VisualizationType/Progress`),
        Criticality: V.path(criticalityPath)
    });
const dfAnno = (target, label, level) => V.rec(`${UI}.DataFieldForAnnotation`, { Target: V.annoPath(target), Label: V.str(label) }, importance(level));
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
                refFacet('HeaderProcess', 'Process', '@UI.FieldGroup#HeaderProcess'),
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
            'SAP__UI.FieldGroup',
            fieldGroup(undefined, [df('ProcessTeam'), df('ProcessVariant'), df('StartObject'), df('Version'), dfCrit('AssignmentStatus', 'AssignmentCriticality')]),
            'HeaderProcess'
        ],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('CaseID', undefined, {}, 'High'),
                df('ScenarioID', 'Scenario', {}, 'Low'),
                df('Title', undefined, {}, 'High'),
                df('ProcessTeam', undefined, {}, 'Medium'),
                df('ProcessVariant', undefined, {}, 'Medium'),
                df('Version', undefined, {}, 'Low'),
                dfCrit('AssignmentStatus', 'AssignmentCriticality', 'Assignment', 'Low'),
                df('ProcessProfile', undefined, {}, 'Low'),
                df('CreatedAt', undefined, {}, 'Low'),
                dfCrit('ValidationStatus', 'ValidationCriticality', 'Validation', 'High'),
                dfCrit('ExecutionStatus', 'ExecutionCriticality', 'Execution', 'High'),
                dfCrit('FinalResult', 'FinalResultCriticality', 'Final Result', 'High'),
                df('ExecutionDuration', 'Duration (s)', {}, 'Low')
            ])
        ],
        [
            'SAP__UI.SelectionFields',
            V.coll(
                ['CaseID', 'ProcessTeam', 'BusinessProcess', 'ProcessVariant', 'FinalResult', 'AssignmentStatus', 'CreatedAt', 'ProcessProfile', 'CreatedBy'].map(V.propPath)
            )
        ],
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
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Process Assignment', [
                df('ProcessTeam'),
                df('BusinessProcess'),
                df('ProcessVariant'),
                df('StartObject'),
                df('EndObject'),
                df('PredecessorTestCase'),
                df('PredecessorObject'),
                df('TestLevel'),
                df('BusinessOwner'),
                df('ProcessVersion'),
                dfCrit('AssignmentStatus', 'AssignmentCriticality'),
                df('AssignmentNote'),
                df('ExternalTestCaseID')
            ]),
            'Process'
        ],
        ['SAP__UI.FieldGroup', fieldGroup('Preconditions', [df('Preconditions')]), 'Preconditions'],
        ['SAP__UI.FieldGroup', fieldGroup('Approval', [df('ApprovalStatus'), df('ApprovedBy'), df('ApprovedAt'), df('Version'), df('ApprovedVersion')]), 'Approval'],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Execution', [
                df('ExternalExecutionID'),
                df('_LatestExecution/ReleaseID', 'Release'),
                df('_LatestExecution/TestCaseVersion', 'Test Case Version'),
                df('_LatestExecution/RunType', 'Run Type'),
                df('_LatestExecution/StartObject', 'Start from'),
                df('_LatestExecution/PredecessorExecution', 'Taken Over From'),
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
                collFacet('ProcessSection', 'Process Reference', [
                    collFacet('ProcessAssignmentGroup', 'Process Assignment', [
                        refFacet('ProcessAssignment', 'Process Assignment', '@UI.FieldGroup#Process'),
                        refFacet('PreconditionsDetails', 'Preconditions', '@UI.FieldGroup#Preconditions')
                    ]),
                    collFacet('TestStepsGroup', 'Test Steps', [refFacet('TestSteps', 'Test Steps', '_Step/@UI.PresentationVariant')])
                ]),
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
                ]),
                collFacet('VersionSection', 'Versions', [refFacet('VersionHistory', 'Versions', '_Version/@UI.PresentationVariant')])
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
        ],
        [
            'SAP__common.SideEffects',
            V.rec('SAP__common.SideEffectsType', {
                SourceProperties: V.coll(['ProcessTeam', 'BusinessProcess', 'ProcessVariant', 'EndObject', 'StartObject', 'PredecessorTestCase'].map(V.propPath)),
                TargetProperties: V.coll(
                    [
                        'ProcessTeam',
                        'BusinessProcess',
                        'ProcessVariant',
                        'EndObject',
                        'StartObject',
                        'PredecessorTestCase',
                        'PredecessorObject',
                        'TestLevel',
                        'BusinessOwner',
                        'ProcessVersion',
                        'AssignmentStatus',
                        'AssignmentCriticality',
                        'AssignmentNote',
                        'ValidationStatus',
                        'ValidationCriticality',
                        'ApprovalStatus',
                        'ApprovalCriticality',
                        'Status',
                        'StatusCriticality',
                        'SAP__Messages',
                        '__OperationControl'
                    ].map(V.str)
                ),
                TargetEntities: V.coll(['_Step', '_TestCaseData', '_ProcessTeam', '_BusinessProcess', '_ProcessVariant', '_BusinessOwner'].map(V.navPath))
            }),
            'ProcessChanged'
        ],
        [
            'SAP__common.SideEffects',
            V.rec('SAP__common.SideEffectsType', {
                SourceEntities: V.coll([V.navPath('_Step')]),
                TargetProperties: V.coll(['AssignmentStatus', 'AssignmentCriticality', 'AssignmentNote'].map(V.str))
            }),
            'StepsChanged'
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
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Reference Object', [df('ServiceRefFunctionalLocation'), df('ServiceReferenceEquipment'), df('ReferenceProduct'), df('ServiceContract')]),
            'ReferenceObject'
        ],
        ['SAP__UI.FieldGroup', fieldGroup('Service Item', [df('ServiceProduct'), df('ServiceDuration')]), 'ServiceItem'],
        ['SAP__UI.FieldGroup', fieldGroup('Service Part', [df('ServicePart'), df('ServicePartQuantity')]), 'PartItem'],
        ['SAP__UI.FieldGroup', fieldGroup('Expected Result', [df('ExpectedNetAmount'), df('NetAmountTolerance')]), 'Expectation'],
        [
            'SAP__common.SideEffects',
            V.rec('SAP__common.SideEffectsType', {
                SourceProperties: V.coll([V.propPath('ServiceReferenceEquipment')]),
                TargetProperties: V.coll(['ReferenceProduct', 'ServiceRefFunctionalLocation', 'ServiceContract', 'SoldToParty'].map(V.str)),
                TargetEntities: V.coll([V.navPath('_ReferenceProduct'), V.navPath('_FunctionalLocation'), V.navPath('_ServiceContract'), V.navPath('_Customer')])
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
                df('ReleaseID'),
                df('TestCaseVersion', 'Version'),
                df('RunType'),
                df('ExecutedBy'),
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
                df('ProcessStepID'),
                df('BusinessObjectType'),
                df('ResponsibleTeam'),
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
                df('ProcessStepID'),
                df('PredecessorDocumentID'),
                df('LifecycleStatus'),
                df('NetAmount'),
                df('DocumentOrigin'),
                df('OriginReference'),
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
                df('ProcessStepID'),
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
    ],
    /* ------------------------------ test steps and versions of the test case ------------------------------ */
    [`${NS}.TestCaseStepType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Test Step', 'Test Steps', 'ProcessStepID', 'Action')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('StepNo', undefined, {}, 'High'),
                df('ProcessStepID', undefined, {}, 'High'),
                df('BusinessObjectType', undefined, {}, 'Medium'),
                df('Action', undefined, {}, 'High'),
                df('ExpectedResult', undefined, {}, 'High'),
                df('ResponsibleTeam', undefined, {}, 'Medium'),
                // no criticality in editable draft tables (FE 1.136 requests it through stale row contexts on Edit)
                df('TeamAssignment', 'Team Assignment', {}, 'Low'),
                df('IsHandover', undefined, {}, 'Low'),
                df('Automation', undefined, {}, 'Low'),
                df('StepSource', undefined, {}, 'Low')
            ])
        ],
        ['SAP__UI.PresentationVariant', sortBy('StepNo')],
        [
            'SAP__common.SideEffects',
            V.rec('SAP__common.SideEffectsType', {
                SourceProperties: V.coll([V.propPath('ProcessStepID')]),
                TargetProperties: V.coll(
                    ['StepName', 'BusinessObjectType', 'ResponsibleTeam', 'TeamAssignment', 'TeamAssignmentCriticality', 'IsHandover', 'Automation'].map(V.str)
                ),
                TargetEntities: V.coll([V.navPath('_ResponsibleTeam')])
            }),
            'ProcessStep'
        ]
    ],
    [`${NS}.TestCaseVersionType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Version', 'Versions', 'Version', 'ChangeSummary')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('Version', undefined, {}, 'High'),
                df('ActivatedAt', undefined, {}, 'High'),
                df('ActivatedBy', undefined, {}, 'Medium'),
                df('ChangeSummary', undefined, {}, 'High'),
                df('ProcessVariant', undefined, {}, 'Low'),
                df('ProcessVersion', undefined, {}, 'Low'),
                dfCrit('ApprovalStatus', 'ApprovalCriticality', 'Approval', 'High'),
                df('ApprovedBy', undefined, {}, 'Medium'),
                df('ApprovedAt', undefined, {}, 'Low')
            ])
        ],
        ['SAP__UI.PresentationVariant', sortBy('Version', true)]
    ],
    /* ------------------------------ process team ------------------------------ */
    [`${NS}.ProcessTeamType`]: [
        ['SAP__common.SemanticKey', V.coll([V.propPath('ProcessTeam')])],
        ['SAP__common.Messages', V.path('SAP__Messages')],
        ['SAP__UI.HeaderInfo', headerInfo('Process Team', 'Process Teams', 'ProcessTeamName', 'ProcessTeam')],
        [
            'SAP__UI.HeaderFacets',
            V.coll([refFacet('HeaderTeam', 'Team', '@UI.FieldGroup#HeaderTeam'), refFacet('HeaderTeamKpi', 'Responsibility', '@UI.FieldGroup#HeaderTeamKpi')])
        ],
        ['SAP__UI.FieldGroup', fieldGroup(undefined, [df('ProcessArea'), df('IsActive')]), 'HeaderTeam'],
        [
            'SAP__UI.FieldGroup',
            fieldGroup(undefined, [df('ProcessOwnerCount'), df('TestExecutorCount'), df('ResponsibleStepCount'), df('TestCaseCount'), df('OpenAssignmentCount')]),
            'HeaderTeamKpi'
        ],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('ProcessTeam', undefined, {}, 'High'),
                df('ProcessTeamName', undefined, {}, 'High'),
                df('ProcessArea', undefined, {}, 'Medium'),
                df('ProcessOwnerCount', undefined, {}, 'Low'),
                df('TestExecutorCount', undefined, {}, 'Low'),
                df('ResponsibleStepCount', undefined, {}, 'Medium'),
                df('TestCaseCount', undefined, {}, 'Medium'),
                df('OpenAssignmentCount', undefined, {}, 'Low'),
                df('IsActive', undefined, {}, 'Low')
            ])
        ],
        ['SAP__UI.SelectionFields', V.coll([V.propPath('ProcessTeam'), V.propPath('ProcessArea')])],
        ['SAP__UI.FieldGroup', fieldGroup('General', [df('ProcessTeam'), df('ProcessTeamName'), df('ProcessArea'), df('Description'), df('IsActive')]), 'General'],
        [
            'SAP__UI.Facets',
            V.coll([
                refFacet('TeamGeneral', 'General Information', '@UI.FieldGroup#General'),
                refFacet('TeamMembers', 'Members and Roles', '_Member/@UI.PresentationVariant'),
                refFacet('TeamSteps', 'Responsible Process Steps', '_ResponsibleStep/@UI.PresentationVariant'),
                refFacet('TeamProcesses', 'Owned Processes', '_OwnedProcess/@UI.PresentationVariant')
            ])
        ]
    ],
    [`${NS}.TeamMemberType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Team Member', 'Team Members', 'UserID', 'TeamRole')],
        ['SAP__UI.LineItem', V.coll([df('UserID', undefined, {}, 'High'), df('TeamRole', undefined, {}, 'High'), df('Note', undefined, {}, 'Medium')])],
        ['SAP__UI.PresentationVariant', sortBy('UserID')]
    ],
    [`${NS}.ProcessStepVHType`]: [
        [
            'SAP__UI.LineItem',
            V.coll([
                df('ProcessID', undefined, {}, 'High'),
                df('Sequence', undefined, {}, 'Low'),
                df('StepID', undefined, {}, 'High'),
                df('BusinessObjectType', undefined, {}, 'Medium'),
                df('TeamAssignment', undefined, {}, 'Medium'),
                df('Variants', undefined, {}, 'Low'),
                df('PilotScope', undefined, {}, 'Low'),
                df('Automation', undefined, {}, 'Low')
            ])
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ],
    [`${NS}.BusinessProcessVHType`]: [
        ['SAP__UI.LineItem', V.coll([df('ProcessID', undefined, {}, 'High'), df('ProcessVersion', undefined, {}, 'Medium'), df('PilotScope', undefined, {}, 'Medium')])],
        ['SAP__UI.PresentationVariant', sortBy('ProcessID')]
    ],
    /* ------------------------------ business process ------------------------------ */
    [`${NS}.BusinessProcessType`]: [
        ['SAP__common.SemanticKey', V.coll([V.propPath('ProcessID')])],
        ['SAP__common.Messages', V.path('SAP__Messages')],
        ['SAP__UI.HeaderInfo', headerInfo('Business Process', 'Business Processes', 'ProcessName', 'ProcessID')],
        [
            'SAP__UI.HeaderFacets',
            V.coll([
                refFacet('HeaderProcessInfo', 'Process', '@UI.FieldGroup#HeaderProcess'),
                refFacet('HeaderProcessVersion', 'Version', '@UI.FieldGroup#HeaderVersion'),
                refFacet('HeaderModeling', 'Process Model', '@UI.DataPoint#Modeling')
            ])
        ],
        ['SAP__UI.FieldGroup', fieldGroup(undefined, [df('OwnerTeam'), df('ProcessArea'), df('PilotScope')]), 'HeaderProcess'],
        ['SAP__UI.FieldGroup', fieldGroup(undefined, [df('ProcessVersion'), df('VersionActivatedAt'), df('VersionActivatedBy')]), 'HeaderVersion'],
        ['SAP__UI.DataPoint', dataPoint('ModelingStatus', 'Process Model', 'ModelingCriticality'), 'Modeling'],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('ProcessID', undefined, {}, 'High'),
                df('ProcessName', undefined, {}, 'High'),
                df('OwnerTeam', undefined, {}, 'Medium'),
                df('ProcessVersion', undefined, {}, 'Medium'),
                dfCrit('ModelingStatus', 'ModelingCriticality', 'Process Model', 'Medium'),
                df('PilotScope', undefined, {}, 'Medium'),
                df('StepCount', undefined, {}, 'Low'),
                df('VariantCount', undefined, {}, 'Low'),
                df('TestCaseCount', undefined, {}, 'Low')
            ])
        ],
        ['SAP__UI.SelectionFields', V.coll([V.propPath('ProcessID'), V.propPath('OwnerTeam'), V.propPath('PilotScope')])],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('General', [df('ProcessID'), df('ProcessName'), df('ProcessArea'), df('OwnerTeam'), df('PilotScope'), df('Description'), df('SAPReference')]),
            'General'
        ],
        ['SAP__UI.FieldGroup', fieldGroup('Version', [df('ProcessVersion'), df('VersionActivatedAt'), df('VersionActivatedBy'), df('VersionNote')]), 'Version'],
        [
            'SAP__UI.Facets',
            V.coll([
                refFacet('ProcessGeneral', 'General Information', '@UI.FieldGroup#General'),
                refFacet('ProcessSteps', 'Process Steps', '_Step/@UI.PresentationVariant'),
                refFacet('ProcessVariants', 'Process Variants', '_Variant/@UI.PresentationVariant'),
                collFacet('ProcessVersionSection', 'Versions', [
                    collFacet('ProcessVersionCurrent', 'Current Version', [refFacet('ProcessVersionDetails', 'Current Version', '@UI.FieldGroup#Version')]),
                    collFacet('ProcessVersionHistory', 'History', [refFacet('ProcessVersionList', 'History', '_Version/@UI.PresentationVariant')])
                ])
            ])
        ]
    ],
    [`${NS}.ProcessStepType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Process Step', 'Process Steps', 'StepID', 'StepName')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('Sequence', undefined, {}, 'Low'),
                df('StepID', undefined, {}, 'High'),
                df('StepName', undefined, {}, 'High'),
                df('BusinessObjectType', undefined, {}, 'Medium'),
                df('ExpectedStatus', undefined, {}, 'Low'),
                df('ResponsibleTeam', undefined, {}, 'High'),
                // no criticality in editable draft tables (FE 1.136 requests it through stale row contexts on Edit)
                df('TeamAssignment', 'Team Assignment', {}, 'Medium'),
                df('Variants', undefined, {}, 'Medium'),
                df('PilotScope', undefined, {}, 'Medium'),
                df('Automation', undefined, {}, 'Medium'),
                df('IsHandover', undefined, {}, 'Low'),
                df('TestCaseCount', undefined, {}, 'Low'),
                df('TestAction', undefined, {}, 'Low'),
                df('TestExpectedResult', undefined, {}, 'Low'),
                df('SAPReference', undefined, {}, 'Low'),
                df('Note', undefined, {}, 'Low')
            ])
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ],
    [`${NS}.ProcessVariantType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Process Variant', 'Process Variants', 'Variant', 'VariantName')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('Sequence', undefined, {}, 'Low'),
                df('Variant', undefined, {}, 'High'),
                df('VariantName', undefined, {}, 'High'),
                df('PilotScope', undefined, {}, 'Medium'),
                df('IsDefault', undefined, {}, 'Low'),
                df('DocumentPath', undefined, {}, 'Medium'),
                df('StepPath', undefined, {}, 'Low'),
                df('TestCaseCount', undefined, {}, 'Low'),
                df('Description', undefined, {}, 'Low')
            ])
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ],
    [`${NS}.ProcessVersionType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Process Version', 'Process Versions', 'ProcessVersion', 'VersionNote')],
        [
            'SAP__UI.LineItem',
            V.coll([df('ProcessVersion'), df('ActivatedAt'), df('ActivatedBy'), df('VersionNote'), df('StepCount'), df('VariantCount')])
        ],
        ['SAP__UI.PresentationVariant', sortBy('ProcessVersion', true)]
    ],
    /* ------------------------------ release ------------------------------ */
    [`${NS}.ReleaseType`]: [
        ['SAP__common.SemanticKey', V.coll([V.propPath('ReleaseID')])],
        ['SAP__common.Messages', V.path('SAP__Messages')],
        ['SAP__UI.HeaderInfo', headerInfo('Release', 'Releases', 'ReleaseName', 'ReleaseID')],
        [
            'SAP__UI.HeaderFacets',
            V.coll([
                refFacet('HeaderRelease', 'Release', '@UI.FieldGroup#HeaderRelease'),
                refFacet('HeaderReleaseStatus', 'Release Status', '@UI.DataPoint#ReleaseStatus'),
                refFacet('HeaderPassRate', 'Pass Rate', '@UI.DataPoint#PassRate'),
                refFacet('HeaderStepCoverage', 'Step Coverage', '@UI.DataPoint#StepCoverage'),
                refFacet('HeaderLatestRun', 'Regression', '@UI.FieldGroup#HeaderRun')
            ])
        ],
        ['SAP__UI.FieldGroup', fieldGroup(undefined, [df('ReleaseType'), df('SAPProductVersion'), df('FeaturePackStack'), df('TestStartDate'), df('TestEndDate')]), 'HeaderRelease'],
        ['SAP__UI.FieldGroup', fieldGroup(undefined, [df('LatestRunID'), dfCrit('LatestRunStatus', 'LatestRunCriticality'), df('LatestRunAt')]), 'HeaderRun'],
        ['SAP__UI.DataPoint', dataPoint('ReleaseStatus', 'Release Status', 'ReleaseStatusCriticality'), 'ReleaseStatus'],
        ['SAP__UI.DataPoint', progressPoint('PassRate', 'Pass Rate', 'PassRateCriticality'), 'PassRate'],
        ['SAP__UI.DataPoint', progressPoint('StepCoverage', 'Step Coverage', 'StepCoverageCriticality'), 'StepCoverage'],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('ReleaseID', undefined, {}, 'High'),
                df('ReleaseName', undefined, {}, 'High'),
                df('ReleaseType', undefined, {}, 'Medium'),
                dfCrit('ReleaseStatus', 'ReleaseStatusCriticality', 'Status', 'High'),
                df('SAPAvailabilityDate', undefined, {}, 'Low'),
                df('TestStartDate', undefined, {}, 'Medium'),
                df('TestEndDate', undefined, {}, 'Low'),
                df('TestCaseCount', undefined, {}, 'Medium'),
                dfAnno('@UI.DataPoint#PassRate', 'Pass Rate', 'High'),
                dfAnno('@UI.DataPoint#StepCoverage', 'Step Coverage', 'Medium')
            ])
        ],
        ['SAP__UI.SelectionFields', V.coll([V.propPath('ReleaseID'), V.propPath('ReleaseType'), V.propPath('ReleaseStatus')])],
        ['SAP__UI.PresentationVariant', sortBy('TestStartDate')],
        [
            'SAP__UI.Identification',
            V.coll([
                dfAction('startRegressionRun', 'Start Regression Run', {}, [hiddenInEditMode]),
                dfAction('refreshRegressionRun', 'Refresh Regression Run', {}, [hiddenInEditMode]),
                dfAction('copyScopeFromPredecessor', 'Copy Scope from Predecessor', {}, [hiddenInEditMode])
            ])
        ],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('General', [
                df('ReleaseID'),
                df('ReleaseName'),
                df('ReleaseType'),
                df('SAPProductVersion'),
                df('FeaturePackStack'),
                df('ReleaseStatus'),
                df('PredecessorRelease'),
                df('AutoRegression'),
                df('Description')
            ]),
            'General'
        ],
        ['SAP__UI.FieldGroup', fieldGroup('Dates', [df('SAPAvailabilityDate'), df('TestStartDate'), df('TestEndDate'), df('GoLiveDate'), df('SourceNote')]), 'Dates'],
        [
            'SAP__UI.FieldGroup',
            fieldGroup('Key Figures', [
                df('ScopeCount'),
                df('TestCaseCount'),
                df('ApprovedCount'),
                df('ExecutedCount'),
                df('PassedCount'),
                df('FailedCount'),
                df('PassRate'),
                df('StepCoverage')
            ]),
            'Kpi'
        ],
        [
            'SAP__UI.Facets',
            V.coll([
                collFacet('ReleaseGeneralSection', 'General Information', [
                    refFacet('ReleaseGeneral', 'General', '@UI.FieldGroup#General'),
                    refFacet('ReleaseDates', 'Dates', '@UI.FieldGroup#Dates'),
                    refFacet('ReleaseKpi', 'Key Figures', '@UI.FieldGroup#Kpi')
                ]),
                refFacet('ReleaseScope', 'Scope: Process Teams and Processes', '_Scope/@UI.PresentationVariant'),
                refFacet('ReleaseTestCases', 'Test Cases in Scope', '_TestCase/@UI.PresentationVariant'),
                refFacet('ReleaseCoverage', 'Coverage per Process Step', '_StepCoverage/@UI.PresentationVariant'),
                collFacet('ReleaseRegressionSection', 'Regression Runs', [
                    collFacet('ReleaseLatestRunGroup', 'Latest Run', [refFacet('ReleaseLatestRunItems', 'Latest Run', '_LatestRunItem/@UI.PresentationVariant')]),
                    collFacet('ReleaseRunHistoryGroup', 'All Runs', [refFacet('ReleaseRunHistory', 'All Runs', '_RegressionRun/@UI.PresentationVariant')])
                ])
            ])
        ]
    ],
    [`${NS}.ReleaseScopeType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Scope Entry', 'Scope Entries', 'ProcessTeam', 'ProcessID')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('ProcessTeam', undefined, {}, 'High'),
                df('ProcessID', undefined, {}, 'High'),
                df('ProcessVersion', undefined, {}, 'Medium'),
                df('IsRegressionRelevant', undefined, {}, 'Medium'),
                df('TestCaseCount', undefined, {}, 'Medium'),
                df('ApprovedCount', undefined, {}, 'Low'),
                df('ExecutedCount', undefined, {}, 'Low'),
                df('PassedCount', undefined, {}, 'Low'),
                df('FailedCount', undefined, {}, 'Low'),
                // status colour as row highlight: cells with criticality log drill-down errors on Edit/Save in FE 1.136
                df('PassRate', undefined, {}, 'High'),
                df('StepCoverage', undefined, {}, 'Medium'),
                df('ScopeStatus', 'Test Status', {}, 'High'),
                df('ScopeNote', undefined, {}, 'Low')
            ]),
            undefined,
            [['SAP__UI.Criticality', V.path('ScopeStatusCriticality')]]
        ],
        ['SAP__UI.PresentationVariant', sortBy('ProcessTeam')]
    ],
    [`${NS}.ReleaseTestCaseType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Test Case in Scope', 'Test Cases in Scope', 'CaseID', 'Title')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('CaseID', undefined, {}, 'High'),
                df('Title', undefined, {}, 'High'),
                df('ProcessTeam', undefined, {}, 'High'),
                df('ProcessVariant', undefined, {}, 'Medium'),
                df('TestLevel', undefined, {}, 'Low'),
                df('EndObject', undefined, {}, 'Low'),
                df('TestCaseVersion', undefined, {}, 'Medium'),
                df('ApprovalStatus', 'Approval', {}, 'Medium'),
                df('IsRegressionRelevant', undefined, {}, 'Low'),
                // result colour as row highlight (see ReleaseScope)
                df('ResultInRelease', 'Result in Release', {}, 'High'),
                df('ExternalExecutionID', undefined, {}, 'Low'),
                df('ExecutedVersion', undefined, {}, 'Low'),
                df('ExecutedAt', undefined, {}, 'Low'),
                df('RunType', undefined, {}, 'Low'),
                df('Remark', undefined, {}, 'Medium')
            ]),
            undefined,
            [['SAP__UI.Criticality', V.path('ResultCriticality')]]
        ],
        ['SAP__UI.PresentationVariant', sortBy('CaseID')]
    ],
    [`${NS}.ReleaseStepCoverageType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Step Coverage', 'Step Coverage', 'StepID', 'StepName')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('Sequence', undefined, {}, 'Low'),
                df('StepID', undefined, {}, 'High'),
                df('StepName', undefined, {}, 'High'),
                df('BusinessObjectType', undefined, {}, 'Low'),
                df('ResponsibleTeam', undefined, {}, 'Medium'),
                df('TeamAssignment', undefined, {}, 'Low'),
                df('IsHandover', undefined, {}, 'Low'),
                df('Automation', undefined, {}, 'Low'),
                df('TestCaseCount', undefined, {}, 'Medium'),
                df('ExecutedCount', undefined, {}, 'Low'),
                df('PassedCount', undefined, {}, 'Low'),
                df('FailedCount', undefined, {}, 'Low'),
                dfCrit('CoverageStatus', 'CoverageCriticality', 'Coverage', 'High'),
                df('LatestDocumentID', undefined, {}, 'Low'),
                df('Remark', undefined, {}, 'Medium')
            ]),
            undefined,
            [['SAP__UI.Criticality', V.path('CoverageCriticality')]]
        ],
        ['SAP__UI.PresentationVariant', sortBy('Sequence')]
    ],
    [`${NS}.RegressionRunType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Regression Run', 'Regression Runs', 'RunID', 'Status')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('RunID', undefined, {}, 'High'),
                dfCrit('Status', 'StatusCriticality', 'Status', 'High'),
                df('Trigger', undefined, {}, 'Low'),
                df('StartedAt', undefined, {}, 'Medium'),
                df('StartedBy', undefined, {}, 'Low'),
                df('CandidateCount', undefined, {}, 'Low'),
                df('StartedCount', undefined, {}, 'Medium'),
                df('SkippedCount', undefined, {}, 'Medium'),
                df('PassedCount', undefined, {}, 'Medium'),
                df('FailedCount', undefined, {}, 'Medium'),
                dfCrit('PassRate', 'PassRateCriticality', 'Pass Rate', 'High'),
                df('FinishedAt', undefined, {}, 'Low')
            ])
        ],
        ['SAP__UI.PresentationVariant', sortBy('StartedAt', true)]
    ],
    [`${NS}.RegressionRunItemType`]: [
        ['SAP__UI.HeaderInfo', headerInfo('Run Item', 'Run Items', 'CaseID', 'Title')],
        [
            'SAP__UI.LineItem',
            V.coll([
                df('Sequence', undefined, {}, 'Low'),
                df('CaseID', undefined, {}, 'High'),
                df('Title', undefined, {}, 'Medium'),
                df('ProcessTeam', undefined, {}, 'Medium'),
                df('ProcessVariant', undefined, {}, 'Low'),
                df('TestCaseVersion', undefined, {}, 'Low'),
                dfCrit('Decision', 'DecisionCriticality', 'Decision', 'High'),
                df('Reason', undefined, {}, 'High'),
                df('ExternalExecutionID', undefined, {}, 'Low'),
                df('ExecutionStatus', undefined, {}, 'Medium'),
                dfCrit('FinalResult', 'ResultCriticality', 'Result', 'High')
            ])
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
/* Release actions: availability via __OperationControl; the run refreshes KPIs, scope, coverage and the run tables */
const releaseTargets = [
    '_it/ScopeCount',
    '_it/TestCaseCount',
    '_it/ApprovedCount',
    '_it/ExecutedCount',
    '_it/PassedCount',
    '_it/FailedCount',
    '_it/PassRate',
    '_it/PassRateCriticality',
    '_it/StepCoverage',
    '_it/StepCoverageCriticality',
    '_it/LatestRunUUID',
    '_it/LatestRunID',
    '_it/LatestRunStatus',
    '_it/LatestRunCriticality',
    '_it/LatestRunAt',
    '_it/__OperationControl'
];
const releaseEntities = ['_it/_Scope', '_it/_TestCase', '_it/_StepCoverage', '_it/_RegressionRun', '_it/_LatestRunItem'];
for (const name of releaseActions) {
    annotations[`${NS}.${name}(${T('Release')})`] = [
        ['SAP__core.OperationAvailable', V.path(`_it/__OperationControl/${name}`)],
        ['SAP__common.SideEffects', sideEffects(releaseTargets, releaseEntities)]
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
    testCaseActions,
    releaseActions
};
