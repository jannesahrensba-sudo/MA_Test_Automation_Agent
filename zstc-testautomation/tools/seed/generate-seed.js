'use strict';
/**
 * Generates the initial mock data of the business objects (webapp/localService/mainService/data/*.json):
 * ProcessProfile, FieldRequirement, process teams with roles, business processes (versioned) with steps and variants,
 * releases with their scope, test cases with test steps and versions, executions, documents, assertions, regression
 * runs and the read models (value helps, release coverage).
 *
 * The seed runs the SAME mock backend services as the running app (validation, process reference, versioning,
 * MockExecutionProvider, VerificationService, traceability) on an in-memory repository, so the seed data is consistent
 * with the behavior.
 *
 * Seed test cases (docs/phase-1-architektur-und-mock-vertrag.md, 3.13; docs/messdienst-szenarien.md):
 *   STC-2026-000001  H2-STC-000 reference run      executed, PASSED; documents BELOW the golden start values
 *   STC-2026-000002  H2-STC-002 wrong equipment    captured, INVALID (EL-200 is not installed at H2POWC00-PROD)
 *   STC-2026-000003  H2-STC-001 golden case        captured, NOT_VALIDATED (quick path for the demo)
 *   STC-2026-000004  MD-HKV-000 reference run      metering service: heat cost allocator exchanged, executed, PASSED
 *   STC-2026-000005  MD-RWM-002 wrong spare part   metering service: heat cost allocator part for a smoke alarm, INVALID (R10)
 *   STC-2026-000006  MD-RWM-001 golden case        metering service: smoke alarm warning tone, NOT_VALIDATED (quick path)
 *   STC-2026-000007  MD-REP-W1-FI  way 1 up to FI   water meter without display, no quotation, executed up to the FI document
 *   STC-2026-000008  MD-REP-W2-REJ way 2 rejected   quotation for a smoke alarm exchange rejected by the customer, executed
 *   STC-2026-000009  MD-REP-W3-NEG way 3 negative   contract of the device expired → INVALID (R11)
 *   STC-2026-000010  MD-REP-W3     way 3 contract   smoke alarm exchange under the service contract, approved
 *   STC-2026-000011  MD-REP-W3-RP  way 3 billing    contract billing plan, approved
 *   STC-2026-000012  MD-ANG-W2     team quotation   sub-process of the quotation team up to the customer acceptance, approved
 * STC-1 to STC-6 belong to the process team repair (way 1 or 2) except STC-2 (legacy without process assignment);
 * STC-4 was changed after its run: version 2 needs a new approval.
 * All metering-service master data is fictional (docs/messdienst-szenarien.md).
 *
 * Generated portfolio (STC-2026-000015 ff.): the test design of the service assistant (webapp/ext/agent/core/testDesign.js)
 * applied to the process model of the repair process and the generated master data (tools/seed/generate-masterdata.js):
 * one end-to-end test case per pilot way and one sub-process test case per further process team, validated (device type
 * corrections R5/R10 like the assistant) and approved by the process owners of the teams — not executed yet.
 *
 * Usage: node tools/seed/generate-masterdata.js && node tools/seed/generate-seed.js
 */
const fs = require('fs');
const path = require('path');
const { createMemoryRepository } = require('../../mock-backend/services/repository');
const service = require('../../mock-backend/services/TestCaseService');
const processService = require('../../mock-backend/services/ProcessService');
const releaseService = require('../../mock-backend/services/ReleaseService');
const traceability = require('../../mock-backend/services/TraceabilityService');
const catalog = require('./process-catalog');
const numberRanges = require('../../mock-backend/common/numberRanges');
const clock = require('../../mock-backend/common/clock');
const { resetProviders } = require('../../mock-backend/execution/MockExecutionProvider');
const { loadUi5Module } = require('../common/loadUi5Module');

const testDesign = loadUi5Module(path.join(__dirname, '../../webapp/ext/agent/core/testDesign.js'));

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
    'TestCaseFieldVH',
    'ServiceContractVH',
    'UserVH'
];

const GENERATED_SETS = [
    'ProcessProfile',
    'FieldRequirement',
    'ProcessTeam',
    'TeamMember',
    'BusinessProcess',
    'ProcessStep',
    'ProcessVariant',
    'ProcessVersion',
    'Release',
    'ReleaseScope',
    'TestCase',
    'TestCaseData',
    'TestCaseStep',
    'TestCaseVersion',
    'ValidationResult',
    'Execution',
    'ExecutionStep',
    'DocumentReference',
    'TestAssertion',
    'ResultFinding',
    'RegressionRun',
    'RegressionRunItem',
    'ReleaseTestCase',
    'ReleaseStepCoverage',
    // read models of the configuration (value helps)
    'ProcessTeamVH',
    'TeamMemberVH',
    'BusinessProcessVH',
    'ProcessVariantVH',
    'ProcessStepVH',
    'ReleaseVH',
    'TestCaseVH'
];

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
    },
    // metering service (Messdienst): fault reports from residents or property managers, technician visit with device exchange
    {
        ProcessProfile: 'MD_HKV_STOER',
        ProcessProfileName: 'Messdienst – Störung Heizkostenverteiler',
        Description:
            'Störungsmeldung zu einem Heizkostenverteiler: Monteureinsatz nach Aufwand mit Austausch des Geräts, Rückmeldung und Faktura an die Hausverwaltung. Vorbelegung: 1 Std. Monteureinsatz, 1 Ersatzgerät.',
        ExecutionProvider: 'MOCK',
        RequiresSecondApprover: false
    },
    {
        ProcessProfile: 'MD_RWM_STOER',
        ProcessProfileName: 'Messdienst – Störung Rauchwarnmelder',
        Description:
            'Störungsmeldung zu einem Rauchwarnmelder (Warnton, Fehlalarm, Demontage, verschmutzte Rauchkammer): Einsatz vor Ort, Austausch des Melders, Rückmeldung und Faktura an die Hausverwaltung. Priorität hoch (Betriebsbereitschaft).',
        ExecutionProvider: 'MOCK',
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

/** metering service: sales organization, one hour technician visit and one replacement device as defaults */
const METERING_DEFAULTS = {
    SalesOrganization: { DefaultValue: '2010' },
    ServiceDuration: { DefaultValue: '1', SourceType: 'DEFAULT' },
    ServicePartQuantity: { DefaultValue: '1', SourceType: 'DEFAULT' }
};

/** profile-specific deviations: FieldName → partial row */
const REQUIREMENT_OVERRIDES = {
    FS_FIXPRICE: {
        ServiceDuration: { Required: false },
        ServicePart: { Required: false },
        ServicePartQuantity: { Required: false },
        ServicePartQuantityUnit: { Required: false }
    },
    MD_HKV_STOER: {
        ...METERING_DEFAULTS,
        ServiceProduct: { DefaultValue: 'MD-SRV-STOER', SourceType: 'DEFAULT' },
        ServicePart: { DefaultValue: 'MD-ERS-HKV', SourceType: 'DEFAULT' }
    },
    MD_RWM_STOER: {
        ...METERING_DEFAULTS,
        ServiceDocumentPriority: { DefaultValue: '3' },
        ServiceProduct: { DefaultValue: 'MD-SRV-RWM', SourceType: 'DEFAULT' },
        ServicePart: { DefaultValue: 'MD-ERS-RWM', SourceType: 'DEFAULT' }
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

const METERING_TEXT_HKV =
    'Frau Müller aus der Musterstraße 12 in München (1. OG links) meldet über Petra Wagner von der Hausverwaltung, dass der Heizkostenverteiler im Wohnzimmer nichts mehr anzeigt – das Display ist komplett dunkel.';
const METERING_TEXT_RWM =
    'Im Kinderzimmer der Wohnung Yilmaz (Musterstraße 12, EG rechts) piept der Rauchmelder alle paar Sekunden, obwohl kein Rauch da ist. Bitte dringend jemanden schicken. Gemeldet von Hausmeister Stefan Brandl.';

const METERING_HKV_DATA = {
    ServiceRequestType: 'SRVR',
    ServiceRequestDescription: 'HKV Wohnzimmer: Display ohne Anzeige',
    SoldToParty: 'MD-100010',
    ServiceRequestReporter: 'MD-CP-1001',
    ServiceDocumentPriority: '5',
    SalesOrganization: '2010',
    ServiceOrganization: 'SO-MD-SUED',
    RespyMgmtServiceTeam: 'MD-TEAM-MUC',
    ServiceRefFunctionalLocation: 'LG-0815-NE03',
    ServiceReferenceEquipment: 'HKV-0815-031',
    ReferenceProduct: 'MD-HKV-FUNK',
    ServiceProduct: 'MD-SRV-STOER',
    ServiceDuration: 1,
    ServiceDurationUnit: 'HR',
    ServicePart: 'MD-ERS-HKV',
    ServicePartQuantity: 1,
    ServicePartQuantityUnit: 'PC',
    ExpectedNetAmount: 108,
    NetAmountTolerance: 0,
    TransactionCurrency: 'EUR'
};

const METERING_RWM_DATA = {
    ...METERING_HKV_DATA,
    ServiceRequestDescription: 'RWM Kinderzimmer: Warnton, Fehlalarm',
    ServiceRequestReporter: 'MD-CP-1002',
    ServiceDocumentPriority: '3',
    ServiceRefFunctionalLocation: 'LG-0815-NE02',
    ServiceReferenceEquipment: 'RWM-0815-022',
    ReferenceProduct: 'MD-RWM-FUNK',
    ServiceProduct: 'MD-SRV-RWM',
    ServicePart: 'MD-ERS-RWM',
    ExpectedNetAmount: 94
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
        process: { team: 'PT-REPARATUR', variant: 'W2_QUOTATION' },
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
        // legacy test case without process reference: the assignment stays OPEN (marked, nothing invented)
        process: undefined,
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
        process: { team: 'PT-REPARATUR', variant: 'W2_QUOTATION' },
        data: { ...GOLDEN_DATA },
        createdAt: '2026-09-28T10:30:00Z',
        run: 'none'
    },
    {
        uuid: '6f1c2a10-0004-4c3e-9a51-000000000004',
        CaseID: 'STC-2026-000004',
        ScenarioID: 'MD-HKV-000',
        Title: 'Referenzlauf: Heizkostenverteiler mit Fehleranzeige getauscht',
        Description:
            'Ausgeführter Referenzlauf Messdienst (Köln): Heizkostenverteiler im Wohnzimmer zeigt eine Fehlermeldung, Monteureinsatz 1 Std. und Ersatzgerät, Faktura an die Hausverwaltung. Alle Belege erzeugt und verifiziert.',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_HKV_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W1_REQUEST' },
        data: { ...METERING_HKV_DATA, ServiceRefFunctionalLocation: 'LG-2040-NE01', ServiceReferenceEquipment: 'HKV-2040-011', SoldToParty: 'MD-100020', ServiceRequestReporter: 'MD-CP-2001', ServiceOrganization: 'SO-MD-WEST', RespyMgmtServiceTeam: 'MD-TEAM-CGN', ServiceRequestDescription: 'HKV Wohnzimmer: Fehleranzeige' },
        createdAt: '2026-09-28T11:00:00Z',
        run: 'execute',
        // changed after the run: version 2 needs a new approval
        changeAfterRun: { Preconditions: 'Bewohner ist über den Termin informiert; Zugang zur Wohnung über die Hausverwaltung.' },
        numbers: {
            EXECUTION: 2,
            SERVICE_REQUEST: 8000000008,
            QUOTATION_ORDER: 8000000027,
            SERVICE_CONFIRMATION: 8999999998,
            BILLING_DOC_REQUEST: 10000010,
            BILLING_DOCUMENT: 90000113,
            ACCOUNTING_DOCUMENT: 1400000098
        }
    },
    {
        uuid: '6f1c2a10-0005-4c3e-9a51-000000000005',
        CaseID: 'STC-2026-000005',
        ScenarioID: 'MD-RWM-002',
        Title: 'Falsches Ersatzteil für den Rauchwarnmelder',
        Description:
            'Negativszenario Messdienst: Für den Rauchwarnmelder im Flur ist ein Ersatz-Heizkostenverteiler geplant. Die Validierung muss das Ersatzteil ablehnen (R10) und MD-ERS-RWM vorschlagen.',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_RWM_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W1_REQUEST' },
        data: {
            ...METERING_RWM_DATA,
            ServiceRequestDescription: 'RWM Flur: Gerät demontiert',
            ServiceRequestReporter: 'MD-CP-1001',
            ServiceRefFunctionalLocation: 'LG-0815-NE03',
            ServiceReferenceEquipment: 'RWM-0815-032',
            ServicePart: 'MD-ERS-HKV',
            ExpectedNetAmount: 98
        },
        createdAt: '2026-09-28T11:30:00Z',
        run: 'validate'
    },
    {
        uuid: '6f1c2a10-0006-4c3e-9a51-000000000006',
        CaseID: 'STC-2026-000006',
        ScenarioID: 'MD-RWM-001',
        Title: 'Golden Case Messdienst: Rauchwarnmelder piept',
        Description:
            'Golden Case Messdienst: Rauchwarnmelder im Kinderzimmer gibt Warntöne ohne Rauch ab. Einsatz vor Ort, Austausch des Melders, Faktura an die Hausverwaltung (Service Request → Angebot → Auftrag → Rückmeldung → Faktura).',
        NaturalLanguageInput: METERING_TEXT_RWM,
        ProcessProfile: 'MD_RWM_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W2_QUOTATION' },
        data: { ...METERING_RWM_DATA },
        createdAt: '2026-09-28T12:00:00Z',
        run: 'none'
    },
    {
        uuid: '6f1c2a10-0007-4c3e-9a51-000000000007',
        CaseID: 'STC-2026-000007',
        ScenarioID: 'MD-REP-W1-FI',
        Title: 'Weg 1 bis FI: Warmwasserzähler ohne Anzeige',
        Description:
            'Weg 1 ohne Angebot: Störung am Warmwasserzähler im Bad, Monteureinsatz 1 Std. mit Ersatzzähler, Faktura an die Hausverwaltung und Prüfung des Buchhaltungsbelegs (Endobjekt FI).',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_HKV_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W1_REQUEST', endObject: 'ACCOUNTING_DOCUMENT' },
        data: {
            ...METERING_HKV_DATA,
            ServiceRequestDescription: 'WZ Bad: keine Anzeige',
            ServiceReferenceEquipment: 'WZ-0815-031',
            ReferenceProduct: 'MD-WZ-FUNK',
            ServicePart: 'MD-ERS-WZ',
            ExpectedNetAmount: 114
        },
        createdAt: '2026-09-28T12:30:00Z',
        run: 'execute',
        numbers: {
            EXECUTION: 3,
            SERVICE_REQUEST: 8000000007,
            QUOTATION_ORDER: 8000000026,
            SERVICE_CONFIRMATION: 8999999997,
            BILLING_DOC_REQUEST: 10000009,
            BILLING_DOCUMENT: 90000112,
            ACCOUNTING_DOCUMENT: 1400000097
        },
        // second run after a change: 2 hours on site, the expected net value was not adapted → FAILED (result analysis demo)
        secondRun: {
            at: '2026-10-01T09:00:00Z',
            data: { ServiceDuration: 2 },
            numbers: {
                EXECUTION: 7,
                SERVICE_REQUEST: 8000000003,
                QUOTATION_ORDER: 8000000022,
                SERVICE_CONFIRMATION: 8999999994,
                BILLING_DOC_REQUEST: 10000007,
                BILLING_DOCUMENT: 90000110,
                ACCOUNTING_DOCUMENT: 1400000095
            }
        }
    },
    {
        uuid: '6f1c2a10-0008-4c3e-9a51-000000000008',
        CaseID: 'STC-2026-000008',
        ScenarioID: 'MD-REP-W2-REJ',
        Title: 'Weg 2 abgelehnt: Angebot für Rauchwarnmelder-Tausch',
        Description:
            'Weg 2 mit Angebot: Die WEG lässt sich den Austausch des Rauchwarnmelders anbieten und lehnt das Angebot ab. Erwartet: Angebot abgelehnt, kein Folgeauftrag.',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_RWM_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W2_REJECTED' },
        data: {
            ...METERING_RWM_DATA,
            SoldToParty: 'MD-100030',
            ServiceRequestReporter: 'MD-CP-3001',
            ServiceRequestDescription: 'RWM Schlafzimmer: Angebot Tausch',
            ServiceDocumentPriority: '5',
            ServiceOrganization: 'SO-MD-OST',
            RespyMgmtServiceTeam: 'MD-TEAM-LEJ',
            ServiceRefFunctionalLocation: 'LG-3100-NE01',
            ServiceReferenceEquipment: 'RWM-3100-011'
        },
        createdAt: '2026-09-28T13:00:00Z',
        run: 'execute',
        numbers: { EXECUTION: 4, SERVICE_REQUEST: 8000000006, QUOTATION_ORDER: 8000000025 }
    },
    {
        uuid: '6f1c2a10-0009-4c3e-9a51-000000000009',
        CaseID: 'STC-2026-000009',
        ScenarioID: 'MD-REP-W3-NEG',
        Title: 'Weg 3 negativ: Gerätemietvertrag abgelaufen',
        Description:
            'Negativszenario Weg 3: Für den Heizkostenverteiler in Köln ist der Gerätemietvertrag 4100000002 angegeben, der am 30.06.2026 abgelaufen ist. Die Validierung muss den Vertrag ablehnen (R11).',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_HKV_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W3_CONTRACT' },
        data: {
            ...METERING_HKV_DATA,
            SoldToParty: 'MD-100020',
            ServiceRequestReporter: 'MD-CP-2002',
            ServiceRequestDescription: 'HKV Wohnzimmer: Fehleranzeige',
            ServiceOrganization: 'SO-MD-WEST',
            RespyMgmtServiceTeam: 'MD-TEAM-CGN',
            ServiceRefFunctionalLocation: 'LG-2040-NE02',
            ServiceReferenceEquipment: 'HKV-2040-021',
            ServiceContract: '4100000002'
        },
        createdAt: '2026-09-28T13:30:00Z',
        run: 'validate'
    },
    {
        uuid: '6f1c2a10-0010-4c3e-9a51-000000000010',
        CaseID: 'STC-2026-000010',
        ScenarioID: 'MD-REP-W3',
        Title: 'Weg 3: Rauchwarnmelder-Tausch aus dem Servicevertrag',
        Description:
            'Weg 3 aus einem Vertrag: Der Rauchwarnmelder im Flur ist defekt; die Vertragsfindung ermittelt den RWM-Servicevertrag der Liegenschaft, der Auftrag referenziert den Vertrag.',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_RWM_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W3_CONTRACT' },
        preconditions: 'Servicevertrag 4100000001 ist freigegeben und deckt die Liegenschaft Musterstraße 12 ab.',
        data: {
            ...METERING_RWM_DATA,
            ServiceRequestDescription: 'RWM Flur: Störung',
            ServiceRequestReporter: 'MD-CP-1001',
            ServiceRefFunctionalLocation: 'LG-0815-NE01',
            ServiceReferenceEquipment: 'RWM-0815-012',
            ServiceContract: '4100000001'
        },
        createdAt: '2026-09-28T14:00:00Z',
        run: 'approve'
    },
    {
        uuid: '6f1c2a10-0011-4c3e-9a51-000000000011',
        CaseID: 'STC-2026-000011',
        ScenarioID: 'MD-REP-W3-RP',
        Title: 'Weg 3: Vertragsabrechnung RWM-Service (Rechnungsplan)',
        Description: 'Weg 3 Rechnungsplan: Die fällige Jahrespauschale des RWM-Servicevertrags wird abgerechnet (Fakturaanforderung → Faktura).',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_RWM_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W3_BILLING_PLAN' },
        preconditions: 'Rechnungsplanposition des Servicevertrags 4100000001 ist fällig.',
        data: {
            SalesOrganization: '2010',
            SoldToParty: 'MD-100010',
            ServiceRefFunctionalLocation: 'LG-0815',
            ServiceContract: '4100000001',
            TransactionCurrency: 'EUR',
            NetAmountTolerance: 0
        },
        createdAt: '2026-09-28T14:30:00Z',
        run: 'approve'
    },
    {
        uuid: '6f1c2a10-0012-4c3e-9a51-000000000012',
        CaseID: 'STC-2026-000012',
        ScenarioID: 'MD-ANG-W2',
        Title: 'Teilprozess Angebot: Angebot bis zur Kundenannahme',
        Description:
            'Teilprozess des Prozessteams Angebot im Reparaturprozess (Weg 2): Der Lauf startet direkt mit dem Angebot (Startpunkt des Teams), legt es an und bucht die Annahme durch den Kunden (Endobjekt Service Quotation).',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_HKV_STOER',
        process: { team: 'PT-ANGEBOT', variant: 'W2_QUOTATION', endObject: 'SERVICE_QUOTATION' },
        preconditions: 'Übergabe vom Prozessteam Reparatur: Service Request liegt vor.',
        approvedBy: 'ANG_LEAD',
        createdBy: 'ANG_TESTER',
        data: {
            ...METERING_HKV_DATA,
            ServiceRequestDescription: 'HKV Wohnzimmer: Angebot Tausch',
            ServiceRequestReporter: 'MD-CP-1002',
            ServiceRefFunctionalLocation: 'LG-0815-NE02',
            ServiceReferenceEquipment: 'HKV-0815-021'
        },
        createdAt: '2026-09-28T15:00:00Z',
        run: 'approve'
    },
    {
        // handover between process teams: repair runs up to the confirmation, the end-to-end team bills it
        uuid: '6f1c2a10-0013-4c3e-9a51-000000000013',
        CaseID: 'STC-2026-000013',
        ScenarioID: 'MD-REP-W1-UEB',
        Title: 'Übergabe an E2E: HKV-Tausch bis zur Rückmeldung',
        Description:
            'Teilprozess des Prozessteams Reparatur (Weg 1): Störung am Heizkostenverteiler in der Küche, Auftrag und Rückmeldung. Der Lauf endet mit der Rückmeldung; die Fakturierung übernimmt das Prozessteam New End to End Prozess (Vorgänger für STC-2026-000014).',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_HKV_STOER',
        process: { team: 'PT-REPARATUR', variant: 'W1_REQUEST', endObject: 'SERVICE_CONFIRMATION' },
        preconditions: 'Gerät HKV-0815-012 ist in der Nutzeinheit NE 01 eingebaut; der Bewohner ist über den Termin informiert.',
        data: {
            ...METERING_HKV_DATA,
            ServiceRequestDescription: 'HKV Küche: Fehleranzeige',
            ServiceRefFunctionalLocation: 'LG-0815-NE01',
            ServiceReferenceEquipment: 'HKV-0815-012'
        },
        createdAt: '2026-09-29T08:00:00Z',
        run: 'execute',
        numbers: {
            EXECUTION: 5,
            SERVICE_REQUEST: 8000000005,
            QUOTATION_ORDER: 8000000024,
            SERVICE_CONFIRMATION: 8999999996,
            BILLING_DOC_REQUEST: 10000008,
            BILLING_DOCUMENT: 90000111,
            ACCOUNTING_DOCUMENT: 1400000096
        }
    },
    {
        uuid: '6f1c2a10-0014-4c3e-9a51-000000000014',
        CaseID: 'STC-2026-000014',
        ScenarioID: 'MD-E2E-W1-FAKT',
        Title: 'E2E-Team: Rückmeldung fakturieren bis zum FI-Beleg',
        Description:
            'Teilprozess des Prozessteams New End to End Prozess: Der Lauf startet mit der Fakturaanforderung (Startpunkt des Teams), übernimmt die Rückmeldung aus dem letzten bestandenen Lauf von STC-2026-000013 und prüft Faktura und Buchhaltungsbeleg.',
        NaturalLanguageInput: '',
        ProcessProfile: 'MD_HKV_STOER',
        process: { team: 'PT-E2E', variant: 'W1_REQUEST', endObject: 'ACCOUNTING_DOCUMENT', predecessor: 'STC-2026-000013' },
        preconditions: 'Übergabe vom Prozessteam Reparatur: Rückmeldung aus STC-2026-000013 abgeschlossen und fakturierbar.',
        data: {
            ...METERING_HKV_DATA,
            ServiceRequestDescription: 'HKV Küche: Fehleranzeige',
            ServiceRefFunctionalLocation: 'LG-0815-NE01',
            ServiceReferenceEquipment: 'HKV-0815-012'
        },
        createdBy: 'E2E_TESTER',
        approvedBy: 'E2E_LEAD',
        executedBy: 'E2E_TESTER',
        createdAt: '2026-09-29T09:00:00Z',
        run: 'execute',
        numbers: {
            EXECUTION: 6,
            SERVICE_REQUEST: 8000000004,
            QUOTATION_ORDER: 8000000023,
            SERVICE_CONFIRMATION: 8999999995,
            BILLING_DOC_REQUEST: 10000008,
            BILLING_DOCUMENT: 90000111,
            ACCOUNTING_DOCUMENT: 1400000096
        }
    }
];

/** generated portfolio: created by the testers of the teams, approved by their process owners */
const PORTFOLIO = {
    firstCaseNo: 15,
    createdAt: '2026-09-30T07:00:00Z',
    referenceDate: '2026-09-30',
    releaseId: 'INT-2026.10',
    creators: { 'PT-REPARATUR': 'REP_TESTER', 'PT-ANGEBOT': 'ANG_TESTER', 'PT-E2E': 'E2E_TESTER' },
    approvers: { 'PT-REPARATUR': 'REP_LEAD', 'PT-ANGEBOT': 'ANG_LEAD', 'PT-E2E': 'E2E_LEAD' }
};
/** device type corrections with a deterministic suggestion (like the service assistant: first suggestion) */
const AUTO_CORRECT_RULES = new Set(['R5_EQUIPMENT_PRODUCT', 'R10_DEVICE_TYPE']);

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

/* ------------------------------------------------------------------------------------------------ */
/* Process teams, business processes (versioned) and releases                                       */
/* ------------------------------------------------------------------------------------------------ */
async function buildProcessCatalog(repo, setTime) {
    // process teams with separately assigned roles
    let memberNo = 0;
    for (const team of catalog.TEAMS) {
        await repo.add('ProcessTeam', { ...team, ...activeFlags(), ...processService.initialProcessTeam(team) });
        for (const [teamId, user, role, note] of catalog.MEMBERS.filter((m) => m[0] === team.ProcessTeam)) {
            memberNo++;
            await repo.add('TeamMember', {
                MemberUUID: `5c1e7d40-${String(memberNo).padStart(4, '0')}-4b2a-8f31-${String(memberNo).padStart(12, '0')}`,
                ProcessTeam: teamId,
                UserID: user,
                TeamRole: role,
                Note: note,
                ...activeFlags()
            });
        }
        await processService.syncTeamValueHelps(repo, team.ProcessTeam);
    }
    // business processes: every version is a saved change of the process model
    let stepNo = 0;
    let variantNo = 0;
    for (const process of catalog.PROCESSES) {
        const { versions, ...fields } = process;
        await repo.add('BusinessProcess', { ...processService.initialBusinessProcess(fields), ...fields, ...activeFlags() });
        for (let index = 0; index < versions.length; index++) {
            const version = index + 1;
            if (process.ProcessID === catalog.REPAIR) {
                for (const [sequence, stepId, name, bo, expected, team, assignment, variants, pilot, automation, action, result, sapRef, note, since] of catalog.REPAIR_STEPS) {
                    if (since !== version) {
                        continue;
                    }
                    stepNo++;
                    await repo.add('ProcessStep', {
                        ProcessStepUUID: `3b8a6f50-${String(stepNo).padStart(4, '0')}-4c7d-9e12-${String(stepNo).padStart(12, '0')}`,
                        ProcessID: catalog.REPAIR,
                        Sequence: sequence,
                        StepID: stepId,
                        StepName: name,
                        BusinessObjectType: bo,
                        ExpectedStatus: expected,
                        ResponsibleTeam: team,
                        TeamAssignment: assignment,
                        TeamAssignmentCriticality: 0,
                        Variants: variants.join(','),
                        PilotScope: pilot,
                        Automation: automation,
                        IsHandover: false,
                        TestAction: action,
                        TestExpectedResult: result,
                        SAPReference: sapRef,
                        Note: note,
                        TestCaseCount: 0,
                        ...activeFlags()
                    });
                }
                for (const [code, name, pilot, isDefault, description, since] of catalog.REPAIR_VARIANTS) {
                    if (since !== version) {
                        continue;
                    }
                    variantNo++;
                    await repo.add('ProcessVariant', {
                        VariantUUID: `4d9b7a60-${String(variantNo).padStart(4, '0')}-4d8e-8f23-${String(variantNo).padStart(12, '0')}`,
                        ProcessID: catalog.REPAIR,
                        Sequence: variantNo * 10,
                        Variant: code,
                        VariantName: name,
                        Description: description,
                        PilotScope: pilot,
                        IsDefault: isDefault,
                        StepPath: '',
                        DocumentPath: '',
                        TestCaseCount: 0,
                        ...activeFlags()
                    });
                }
            }
            setTime(Date.parse(versions[index].at));
            await repo.update('BusinessProcess', { ProcessID: process.ProcessID, IsActiveEntity: true }, { VersionNote: versions[index].note });
            await processService.onProcessActivated(repo, process.ProcessID, 'REP_LEAD');
        }
    }
    // releases with their scope (link table release × process team × process version)
    let scopeNo = 0;
    for (const release of catalog.RELEASES) {
        await repo.add('Release', { ...releaseService.initialRelease(release), ...release, ...activeFlags() });
        for (const [releaseId, team, processId, version, regression, note] of catalog.SCOPES.filter((sc) => sc[0] === release.ReleaseID)) {
            scopeNo++;
            await repo.add('ReleaseScope', {
                ScopeUUID: `2a7c5e30-${String(scopeNo).padStart(4, '0')}-4e9f-8a34-${String(scopeNo).padStart(12, '0')}`,
                ReleaseID: releaseId,
                ProcessTeam: team,
                ProcessID: processId,
                ProcessVersion: version,
                IsRegressionRelevant: regression,
                ScopeNote: note,
                ...(await releaseService.initialScope(repo, { ProcessTeam: team, ProcessID: processId })),
                ...activeFlags(),
                ProcessVersion: version
            });
        }
        await releaseService.syncReleaseValueHelp(repo, release.ReleaseID);
        await releaseService.syncDerived(repo, release.ReleaseID);
    }
}

/**
 * Generated test case portfolio: the proposals of the test design for the repair process become saved, validated and
 * approved test cases (STC-2026-000015 ff.).
 *
 * @param {object} repo repository
 * @param {Function} setTime sets the seed clock
 * @returns {Promise<object[]>} created test cases {CaseID, title, status}
 */
async function seedPortfolio(repo, setTime) {
    const existing = [];
    for (const tc of await repo.find('TestCase', { IsActiveEntity: true })) {
        const data = (await repo.findOne('TestCaseData', { TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: true })) || {};
        existing.push({ ...tc, LatestResult: tc.FinalResult, equipment: data.ServiceReferenceEquipment, contract: data.ServiceContract, customer: data.SoldToParty });
    }
    const d = repo.data;
    const planned = testDesign.plan({
        process: await repo.findOne('BusinessProcessVH', { ProcessID: catalog.REPAIR }),
        steps: await repo.find('ProcessStepVH', { ProcessID: catalog.REPAIR }),
        variants: await repo.find('ProcessVariant', { ProcessID: catalog.REPAIR, IsActiveEntity: true }),
        teams: d.ProcessTeamVH,
        pools: {
            customers: d.CustomerVH,
            contacts: d.ContactPersonVH,
            functionalLocations: d.FunctionalLocationVH,
            equipments: d.EquipmentVH,
            products: d.ProductVH,
            serviceTeams: d.ServiceTeamVH,
            serviceContracts: d.ServiceContractVH
        },
        existing,
        referenceDate: PORTFOLIO.referenceDate,
        prefix: 'GEN',
        releaseId: PORTFOLIO.releaseId
    });
    const created = [];
    let index = 0;
    for (const proposal of planned.proposals) {
        const caseNo = PORTFOLIO.firstCaseNo + index;
        index++;
        setTime(Date.parse(PORTFOLIO.createdAt) + index * 15 * 60 * 1000);
        const uuid = `6f1c2a10-${String(caseNo).padStart(4, '0')}-4c3e-9a51-${String(caseNo).padStart(12, '0')}`;
        const keys = { TestCaseUUID: uuid, IsActiveEntity: true };
        const createdBy = PORTFOLIO.creators[proposal.team] || 'DEMO_USER';
        await repo.add('TestCase', {
            TestCaseUUID: uuid,
            ...activeFlags(),
            CaseID: `STC-2026-${String(caseNo).padStart(6, '0')}`,
            ScenarioID: proposal.scenarioId,
            Title: proposal.title,
            Description: proposal.description,
            NaturalLanguageInput: '',
            ...service.initialTestCase({
                ProcessProfile: proposal.profile,
                ProcessTeam: proposal.team,
                BusinessProcess: proposal.process,
                ProcessVariant: proposal.variant,
                EndObject: proposal.endObject,
                StartObject: proposal.startObject,
                Preconditions: proposal.preconditions
            }),
            CreatedBy: createdBy,
            ApprovedBy: null,
            ApprovedAt: null,
            ExecutionStartedAt: null,
            ExecutionFinishedAt: null,
            ExecutionDuration: null,
            ExternalExecutionID: '',
            LatestExecutionUUID: null
        });
        await repo.add('TestCaseData', {
            TestCaseUUID: uuid,
            ...activeFlags(),
            ...Object.fromEntries(service.CONTROLLED_FIELDS.map((f) => [f, null])),
            SalesOrganizationOrgUnitID: '',
            ...defaultsOf(repo, proposal.profile),
            ...proposal.data,
            __FieldControl: {}
        });
        await service.determineProcessReference(repo, keys, [], createdBy);
        const { pools } = await service.loadPools(repo);
        const context = await service.pathContext(repo, await repo.findOne('TestCase', keys));
        await service.determineTestData(repo, await repo.findOne('TestCaseData', keys), pools, [], context);
        // validation and the deterministic corrections of the assistant before the first version is saved
        await service.validateTestCase(repo, keys, { asStateMessages: false });
        const fixes = (await repo.find('ValidationResult', keys)).filter((f) => AUTO_CORRECT_RULES.has(f.RuleID) && f.SuggestedValues);
        if (fixes.length) {
            const patch = { ExpectedNetAmount: null };
            fixes.forEach((f) => {
                patch[f.FieldName] = String(f.SuggestedValues).split(',')[0].trim();
            });
            await repo.update('TestCaseData', keys, patch);
            await service.determineTestData(repo, await repo.findOne('TestCaseData', keys), pools, Object.keys(patch), context);
        }
        await service.onActivated(repo, keys, createdBy);
        setTime(Date.parse(PORTFOLIO.createdAt) + index * 15 * 60 * 1000 + 5 * 60 * 1000);
        const { result } = await service.validateTestCase(repo, keys, { asStateMessages: false });
        if (result.overall === 'VALID') {
            setTime(Date.parse(PORTFOLIO.createdAt) + index * 15 * 60 * 1000 + 10 * 60 * 1000);
            await service.approve(repo, keys, PORTFOLIO.approvers[proposal.team] || 'QA_LEAD');
        }
        await repo.update('TestCase', keys, { SAP__Messages: [] });
        await service.syncDerived(repo, uuid);
        const tc = await repo.findOne('TestCase', keys);
        created.push({ CaseID: tc.CaseID, title: tc.Title, status: `${tc.ValidationStatus}/${tc.ApprovalStatus}`, fixes: fixes.map((f) => f.RuleID) });
    }
    return created;
}

/** default values of a process profile (FieldRequirement.DefaultValue), like a new draft of that profile (TestCaseService.createTestData) */
function defaultsOf(repo, profile) {
    const defaults = {};
    const relevant = (r) =>
        r.ProcessProfile === profile && r.Active !== false && service.CONTROLLED_FIELDS.includes(r.FieldName) && r.DefaultValue !== '' && r.DefaultValue !== null && r.DefaultValue !== undefined;
    for (const req of repo.data.FieldRequirement.filter(relevant)) {
        defaults[req.FieldName] = ['ServiceDuration', 'ServicePartQuantity', 'ExpectedNetAmount', 'NetAmountTolerance'].includes(req.FieldName) ? Number(req.DefaultValue) : req.DefaultValue;
    }
    return defaults;
}

async function main() {
    const dataBySet = {};
    for (const set of VALUE_HELP_SETS) {
        dataBySet[set] = readJson(set);
    }
    const { profiles, requirements } = buildConfiguration();
    for (const set of GENERATED_SETS) {
        dataBySet[set] = [];
    }
    dataBySet.ProcessProfile = profiles;
    dataBySet.FieldRequirement = requirements;

    const repo = createMemoryRepository(dataBySet, TENANT);
    let uuidCounter = 0;
    const originalRandomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    globalThis.crypto.randomUUID = () => {
        uuidCounter++;
        return `9e3f4c30-${String(uuidCounter).padStart(4, '0')}-4a5b-9c6d-${String(uuidCounter).padStart(12, '0')}`;
    };
    // seed documents lie BELOW the golden start values (SIM-2), the seed executions are MOCK-<date>-0001 … -0004
    const DEFAULT_SEED_NUMBERS = {
        EXECUTION: 1,
        SERVICE_REQUEST: 8000000009,
        QUOTATION_ORDER: 8000000028,
        SERVICE_CONFIRMATION: 8999999999,
        BILLING_DOC_REQUEST: 10000011,
        BILLING_DOCUMENT: 90000114,
        ACCOUNTING_DOCUMENT: 1400000099
    };

    try {
        let time = SEED_TIME;
        clock.setClock(() => time);
        await buildProcessCatalog(repo, (ms) => {
            time = ms;
        });
        for (const seed of CASES) {
            time = Date.parse(seed.createdAt);
            const keys = { TestCaseUUID: seed.uuid, IsActiveEntity: true };
            const createdBy = seed.createdBy || 'DEMO_USER';
            const tc = {
                TestCaseUUID: seed.uuid,
                ...activeFlags(),
                CaseID: seed.CaseID,
                ScenarioID: seed.ScenarioID,
                Title: seed.Title,
                Description: seed.Description,
                NaturalLanguageInput: seed.NaturalLanguageInput,
                ...service.initialTestCase({
                    ProcessProfile: seed.ProcessProfile,
                    ProcessTeam: seed.process?.team,
                    BusinessProcess: seed.process ? catalog.REPAIR : '',
                    ProcessVariant: seed.process?.variant,
                    EndObject: seed.process?.endObject,
                    StartObject: seed.process?.start,
                    PredecessorTestCase: seed.process?.predecessor,
                    Preconditions: seed.preconditions
                }),
                CreatedBy: createdBy,
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
            if (seed.process) {
                // process reference: end object, test level, business owner and the test steps of the path
                await service.determineProcessReference(repo, keys, [], createdBy);
                const { pools } = await service.loadPools(repo);
                const data = await repo.findOne('TestCaseData', keys);
                await service.determineTestData(repo, data, pools, [], await service.pathContext(repo, await repo.findOne('TestCase', keys)));
            }
            await service.onActivated(repo, keys, createdBy);
            if (seed.run !== 'none') {
                time += 5 * 60 * 1000;
                await service.validateTestCase(repo, keys, { asStateMessages: false });
            }
            if (seed.run === 'approve' || seed.run === 'execute') {
                time += 10 * 60 * 1000;
                await service.approve(repo, keys, seed.approvedBy || 'QA_LEAD');
            }
            if (seed.run === 'execute') {
                numberRanges.setNext(TENANT, seed.numbers || DEFAULT_SEED_NUMBERS);
                time += 60 * 1000;
                await service.startExecution(repo, keys, { user: seed.executedBy || 'REP_TESTER' });
                time += 20 * 1000;
                await service.refreshExecution(repo, keys);
            }
            if (seed.secondRun) {
                // change of the approved test case, new approval, second run in the release in test
                time = Date.parse(seed.secondRun.at);
                await repo.update('TestCaseData', keys, seed.secondRun.data);
                await service.onActivated(repo, keys, createdBy);
                time += 5 * 60 * 1000;
                await service.validateTestCase(repo, keys, { asStateMessages: false });
                time += 10 * 60 * 1000;
                await service.approve(repo, keys, seed.approvedBy || 'QA_LEAD');
                numberRanges.setNext(TENANT, seed.secondRun.numbers);
                time += 60 * 1000;
                await service.startExecution(repo, keys, { user: seed.executedBy || 'REP_TESTER' });
                time += 20 * 1000;
                await service.refreshExecution(repo, keys);
            }
            if (seed.changeAfterRun) {
                // a change of the approved test case: new version, the approval of version 1 no longer applies
                time += 30 * 60 * 1000;
                await repo.update('TestCase', keys, seed.changeAfterRun);
                await service.onActivated(repo, keys, createdBy);
            }
            await repo.update('TestCase', keys, { SAP__Messages: [], ChangedAt: new Date(time).toISOString() });
            await service.syncDerived(repo, seed.uuid);
        }
        const portfolio = await seedPortfolio(repo, (ms) => {
            time = ms;
        });
        console.log(`generated portfolio: ${portfolio.map((c) => `${c.CaseID} ${c.status}${c.fixes.length ? ` (${c.fixes.join(', ')})` : ''} ${c.title}`).join('\n  ')}`);
        time = Date.parse('2026-10-01T16:00:00Z');
        await traceability.refreshAll(repo);
        for (const release of catalog.RELEASES) {
            await releaseService.syncDerived(repo, release.ReleaseID);
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
    const summary = dataBySet.TestCase.map(
        (t) => `${t.CaseID} v${t.Version}/${t.ApprovedVersion} ${t.ProcessTeam || '-'} ${t.ProcessVariant || '-'} ${t.AssignmentStatus} ${t.ValidationStatus}/${t.ApprovalStatus}/${t.ExecutionStatus}/${t.FinalResult || '-'}`
    );
    const documents = dataBySet.DocumentReference.map((d) => d.DocumentID).join(' ');
    console.log(`documents: ${documents}`);
    console.log(summary.join('\n'));
    console.log(dataBySet.Release.map((r) => `${r.ReleaseID} ${r.ReleaseStatus} scope ${r.ScopeCount} cases ${r.TestCaseCount} passed ${r.PassedCount}/${r.ExecutedCount} coverage ${r.StepCoverage}%`).join('\n'));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
