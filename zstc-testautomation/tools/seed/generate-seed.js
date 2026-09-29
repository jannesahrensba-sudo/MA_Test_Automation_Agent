'use strict';
/**
 * Generates the initial mock data of the business objects (webapp/localService/mainService/data/*.json):
 * ProcessProfile, FieldRequirement, TestCase, TestCaseData, ValidationResult, Execution, ExecutionStep,
 * DocumentReference, TestAssertion.
 *
 * The seed runs the SAME mock backend services as the running app (validation, MockExecutionProvider,
 * VerificationService) on an in-memory repository, so the seed data is consistent with the behavior.
 *
 * Seed test cases (docs/phase-1-architektur-und-mock-vertrag.md, 3.13):
 *   STC-2026-000001  H2-STC-000 reference run      executed, PASSED; documents BELOW the golden start values
 *   STC-2026-000002  H2-STC-002 wrong equipment    captured, INVALID (EL-200 is not installed at H2POWC00-PROD)
 *   STC-2026-000003  H2-STC-001 golden case        captured, NOT_VALIDATED (quick path for the demo)
 *
 * Usage: node tools/seed/generate-seed.js
 */
const fs = require('fs');
const path = require('path');
const { createMemoryRepository } = require('../../mock-backend/services/repository');
const service = require('../../mock-backend/services/TestCaseService');
const numberRanges = require('../../mock-backend/common/numberRanges');
const clock = require('../../mock-backend/common/clock');
const { resetProviders } = require('../../mock-backend/execution/MockExecutionProvider');

const DATA_DIR = path.join(__dirname, '../../webapp/localService/mainService/data');
const TENANT = 'tenant-seed';
const SEED_TIME = Date.parse('2026-09-28T08:00:00Z');

const VALUE_HELP_SETS = [
    'CustomerVH',
    'ContactPersonVH',
    'FunctionalLocationVH',
    'EquipmentVH',
    'ProductVH',
    'SalesOrganizationVH',
    'ServiceOrganizationVH',
    'ServiceTeamVH',
    'ServiceDocumentPriorityVH',
    'ServiceRequestTypeVH',
    'UnitOfMeasureVH',
    'CurrencyVH',
    'ProcessProfileVH',
    'TestCaseFieldVH'
];

const GENERATED_SETS = ['ProcessProfile', 'FieldRequirement', 'TestCase', 'TestCaseData', 'ValidationResult', 'Execution', 'ExecutionStep', 'DocumentReference', 'TestAssertion'];

/* ------------------------------------------------------------------------------------------------ */
/* Configuration: process profiles and field requirements (Anhang B)                                */
/* ------------------------------------------------------------------------------------------------ */
const PROFILES = [
    {
        ProcessProfile: 'FS_TM',
        ProcessProfileName: 'Field Service – Time & Material',
        Description: 'On-site service billed by time and material. The billing document request follows the service confirmation.',
        ExecutionProvider: 'MOCK',
        RequiresSecondApprover: false
    },
    {
        ProcessProfile: 'FS_FIXPRICE',
        ProcessProfileName: 'Field Service – Fixed Price',
        Description: 'On-site service at a fixed price. The billing document request follows the service order; the service part is optional.',
        ExecutionProvider: 'MOCK',
        RequiresSecondApprover: false
    },
    {
        ProcessProfile: 'FS_TM_4EYES',
        ProcessProfileName: 'Field Service – T&M, Four-Eyes Approval',
        Description: 'Like FS_TM, but the approval needs a second person (demo of AUTHORIZATION_ERROR).',
        ExecutionProvider: 'MOCK',
        RequiresSecondApprover: true
    },
    {
        ProcessProfile: 'FS_TM_OUTAGE',
        ProcessProfileName: 'Field Service – T&M, Provider Outage (Demo)',
        Description: 'Like FS_TM, but the execution provider is not reachable (demo of TECHNICAL_ERROR).',
        ExecutionProvider: 'MOCK_UNAVAILABLE',
        RequiresSecondApprover: false
    }
];

// [BusinessObject, FieldName, Required, ValidationRule, DefaultValue, SourceType]
const REQUIREMENTS_TM = [
    ['SERVICE_REQUEST', 'ServiceRequestType', true, 'R2_EXISTS', 'SRVR', 'CONSTANT'],
    ['SERVICE_REQUEST', 'SoldToParty', true, 'R2_EXISTS', '', 'VALUE_HELP'],
    ['SERVICE_REQUEST', 'ServiceRequestDescription', true, 'R1_REQUIRED', '', 'FREE_TEXT'],
    ['SERVICE_REQUEST', 'ServiceRequestReporter', true, 'R8_CONTACT_CUSTOMER', '', 'VALUE_HELP'],
    ['SERVICE_REQUEST', 'ServiceDocumentPriority', true, 'R2_EXISTS', '5', 'VALUE_HELP'],
    ['SERVICE_REQUEST', 'SalesOrganization', true, 'R2_EXISTS', '1010', 'VALUE_HELP'],
    ['SERVICE_REQUEST', 'ServiceOrganization', false, 'R2_EXISTS', '', 'VALUE_HELP'],
    ['SERVICE_REQUEST', 'RespyMgmtServiceTeam', true, 'R2_EXISTS', '', 'VALUE_HELP'],
    ['SERVICE_REQUEST', 'ServiceProfile', false, 'NONE', '', 'FREE_TEXT'],
    ['SERVICE_REQUEST', 'ResponseProfile', false, 'NONE', '', 'FREE_TEXT'],
    ['SERVICE_REQUEST', 'RequestedServiceStartDateTime', false, 'R9_DATE_RANGE', '', 'USER'],
    ['SERVICE_REQUEST', 'RequestedServiceEndDateTime', false, 'R9_DATE_RANGE', '', 'USER'],
    ['SERVICE_REQUEST', 'ServiceRefFunctionalLocation', true, 'R3_CUSTOMER_FL', '', 'VALUE_HELP'],
    ['SERVICE_REQUEST', 'ServiceReferenceEquipment', true, 'R4_FL_EQUIPMENT', '', 'VALUE_HELP'],
    ['SERVICE_REQUEST', 'ReferenceProduct', true, 'R5_EQUIPMENT_PRODUCT', '', 'DERIVED'],
    ['SERVICE_ORDER', 'ServiceProduct', true, 'R6_PRODUCT_TYPE', '', 'VALUE_HELP'],
    ['SERVICE_ORDER', 'ServiceDuration', true, 'R1_REQUIRED', '', 'USER'],
    ['SERVICE_ORDER', 'ServiceDurationUnit', true, 'R6_PRODUCT_TYPE', 'HR', 'CONSTANT'],
    ['SERVICE_ORDER', 'ServicePart', true, 'R6_PRODUCT_TYPE', '', 'VALUE_HELP'],
    ['SERVICE_ORDER', 'ServicePartQuantity', true, 'R1_REQUIRED', '', 'USER'],
    ['SERVICE_ORDER', 'ServicePartQuantityUnit', true, 'R6_PRODUCT_TYPE', 'PC', 'CONSTANT'],
    ['BILLING_DOCUMENT', 'ExpectedNetAmount', true, 'R1_REQUIRED', '', 'USER'],
    ['BILLING_DOCUMENT', 'NetAmountTolerance', false, 'NONE', '0', 'DEFAULT'],
    ['BILLING_DOCUMENT', 'TransactionCurrency', true, 'R2_EXISTS', 'EUR', 'CONSTANT']
];

/** profile-specific deviations: FieldName → partial row */
const REQUIREMENT_OVERRIDES = {
    FS_FIXPRICE: {
        ServiceDuration: { Required: false },
        ServicePart: { Required: false },
        ServicePartQuantity: { Required: false },
        ServicePartQuantityUnit: { Required: false }
    }
};

/* ------------------------------------------------------------------------------------------------ */
/* Seed test cases                                                                                   */
/* ------------------------------------------------------------------------------------------------ */
const GOLDEN_TEXT =
    'Customer C700-C00 (North Sea Energy – H2 Power – 00) reports "System cooling partially failed" on equipment EL-100 at functional location H2POWC00-PROD. ' +
    'Reporter Michael Fischer, service team ICNT_1SUP-DE, priority medium. Plan on-site service P700_SERV_ONS 3 HR and spare part P700-SC-100 1 PC. ' +
    'Expected net value 3.693 EUR.';

const GOLDEN_DATA = {
    ServiceRequestType: 'SRVR',
    ServiceRequestDescription: 'System cooling partially failed',
    SoldToParty: 'C700-C00',
    ServiceRequestReporter: 'CP-700001',
    ServiceDocumentPriority: '5',
    SalesOrganization: '1010',
    ServiceOrganization: 'SO-DE-NORTH',
    RespyMgmtServiceTeam: 'ICNT_1SUP-DE',
    ServiceRefFunctionalLocation: 'H2POWC00-PROD',
    ServiceReferenceEquipment: 'EL-100',
    ReferenceProduct: 'P700-EL-100',
    ServiceProduct: 'P700_SERV_ONS',
    ServiceDuration: 3,
    ServiceDurationUnit: 'HR',
    ServicePart: 'P700-SC-100',
    ServicePartQuantity: 1,
    ServicePartQuantityUnit: 'PC',
    ExpectedNetAmount: 3693,
    NetAmountTolerance: 0,
    TransactionCurrency: 'EUR'
};

const CASES = [
    {
        uuid: '6f1c2a10-0001-4c3e-9a51-000000000001',
        CaseID: 'STC-2026-000001',
        ScenarioID: 'H2-STC-000',
        Title: 'Reference run: cooling repair, time & material',
        Description: 'Executed reference run of the service-to-cash chain for North Sea Energy – H2 Power – 00. All documents created and verified.',
        NaturalLanguageInput: '',
        ProcessProfile: 'FS_TM',
        data: { ...GOLDEN_DATA, ServiceRequestDescription: 'Cooling circuit pressure drop' },
        createdAt: '2026-09-28T08:00:00Z',
        run: 'execute'
    },
    {
        uuid: '6f1c2a10-0002-4c3e-9a51-000000000002',
        CaseID: 'STC-2026-000002',
        ScenarioID: 'H2-STC-002',
        Title: 'Wrong equipment for the functional location',
        Description: 'Negative scenario: equipment EL-200 is installed at H2POWC01-PROD, not at H2POWC00-PROD. The validation must reject it.',
        NaturalLanguageInput: '',
        ProcessProfile: 'FS_TM',
        data: { ...GOLDEN_DATA, ServiceReferenceEquipment: 'EL-200', ReferenceProduct: 'P700-EL-200' },
        createdAt: '2026-09-28T09:15:00Z',
        run: 'validate'
    },
    {
        uuid: '6f1c2a10-0003-4c3e-9a51-000000000003',
        CaseID: 'STC-2026-000003',
        ScenarioID: 'H2-STC-001',
        Title: 'Golden case: system cooling partially failed',
        Description: 'Golden test case H2-STC-001 of the service-to-cash chain (service request → quotation → order → confirmation → billing).',
        NaturalLanguageInput: GOLDEN_TEXT,
        ProcessProfile: 'FS_TM',
        data: { ...GOLDEN_DATA },
        createdAt: '2026-09-28T10:30:00Z',
        run: 'none'
    }
];

/* ------------------------------------------------------------------------------------------------ */
function readJson(name) {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'));
}

function activeFlags() {
    return { IsActiveEntity: true, HasActiveEntity: false, HasDraftEntity: false, DraftAdministrativeData: null };
}

function buildConfiguration() {
    const profiles = PROFILES.map((p) => ({
        ...p,
        IsActive: true,
        ...activeFlags(),
        SAP__Messages: [],
        __EntityControl: { Updatable: true, Deletable: true }
    }));
    const requirements = [];
    let n = 0;
    for (const profile of PROFILES) {
        REQUIREMENTS_TM.forEach(([bo, field, required, rule, defaultValue, source], index) => {
            n++;
            requirements.push({
                FieldRequirementUUID: `7a2d3b20-${String(n).padStart(4, '0')}-4d4f-8b62-${String(n).padStart(12, '0')}`,
                ProcessProfile: profile.ProcessProfile,
                Sequence: (index + 1) * 10,
                BusinessObject: bo,
                FieldName: field,
                Required: required,
                ValidationRule: rule,
                DefaultValue: defaultValue,
                SourceType: source,
                Active: true,
                ...activeFlags(),
                ...(REQUIREMENT_OVERRIDES[profile.ProcessProfile]?.[field] || {})
            });
        });
    }
    return { profiles, requirements };
}

async function main() {
    const dataBySet = {};
    for (const set of VALUE_HELP_SETS) {
        dataBySet[set] = readJson(set);
    }
    const { profiles, requirements } = buildConfiguration();
    dataBySet.ProcessProfile = profiles;
    dataBySet.FieldRequirement = requirements;
    for (const set of GENERATED_SETS.slice(2)) {
        dataBySet[set] = [];
    }

    const repo = createMemoryRepository(dataBySet, TENANT);
    let uuidCounter = 0;
    const originalRandomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    globalThis.crypto.randomUUID = () => {
        uuidCounter++;
        return `9e3f4c30-${String(uuidCounter).padStart(4, '0')}-4a5b-9c6d-${String(uuidCounter).padStart(12, '0')}`;
    };
    // seed documents lie BELOW the golden start values (SIM-2), the seed execution is MOCK-<date>-0001
    numberRanges.setNext(TENANT, {
        EXECUTION: 1,
        SERVICE_REQUEST: 8000000009,
        QUOTATION_ORDER: 8000000028,
        SERVICE_CONFIRMATION: 8999999999,
        BILLING_DOC_REQUEST: 10000011,
        BILLING_DOCUMENT: 90000114
    });

    try {
        for (const seed of CASES) {
            let time = Date.parse(seed.createdAt);
            clock.setClock(() => time);
            const keys = { TestCaseUUID: seed.uuid, IsActiveEntity: true };
            const tc = {
                TestCaseUUID: seed.uuid,
                ...activeFlags(),
                CaseID: seed.CaseID,
                ScenarioID: seed.ScenarioID,
                Title: seed.Title,
                Description: seed.Description,
                NaturalLanguageInput: seed.NaturalLanguageInput,
                ...service.initialTestCase({ ProcessProfile: seed.ProcessProfile }),
                ApprovedBy: null,
                ApprovedAt: null,
                ExecutionStartedAt: null,
                ExecutionFinishedAt: null,
                ExecutionDuration: null,
                ExternalExecutionID: '',
                LatestExecutionUUID: null
            };
            await repo.add('TestCase', tc);
            await repo.add('TestCaseData', {
                TestCaseUUID: seed.uuid,
                ...activeFlags(),
                ...Object.fromEntries(service.CONTROLLED_FIELDS.map((f) => [f, null])),
                SalesOrganizationOrgUnitID: '',
                ...seed.data,
                __FieldControl: {}
            });
            if (seed.run === 'validate' || seed.run === 'execute') {
                time += 5 * 60 * 1000;
                await service.validateTestCase(repo, keys, { asStateMessages: false });
            }
            if (seed.run === 'execute') {
                time += 10 * 60 * 1000;
                await service.approve(repo, keys);
                // the seed approval is recorded for a second person (QA_LEAD); DEMO_USER approves new FS_TM test cases itself
                await repo.update('TestCase', keys, { ApprovedBy: 'QA_LEAD' });
                time += 60 * 1000;
                await service.startExecution(repo, keys);
                time += 13 * 1000;
                await service.refreshExecution(repo, keys);
            }
            await repo.update('TestCase', keys, { SAP__Messages: [], ChangedAt: new Date(time).toISOString() });
            await service.syncDerived(repo, seed.uuid);
        }
    } finally {
        clock.resetClock();
        globalThis.crypto.randomUUID = originalRandomUUID;
        numberRanges.reset(TENANT);
        resetProviders();
    }

    for (const set of GENERATED_SETS) {
        const rows = dataBySet[set].map((row) => ({ ...row }));
        fs.writeFileSync(path.join(DATA_DIR, `${set}.json`), `${JSON.stringify(rows, null, 4)}\n`);
        console.log(`${set}.json: ${rows.length} rows`);
    }
    const summary = dataBySet.TestCase.map((t) => `${t.CaseID} ${t.ValidationStatus}/${t.ApprovalStatus}/${t.ExecutionStatus}/${t.FinalResult || '-'}`);
    console.log(summary.join('\n'));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
