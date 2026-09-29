'use strict';
/**
 * Test helpers: an in-memory repository loaded with the mock data of the app (value help pools, configuration and
 * seed test cases) and a controllable clock.
 */
const fs = require('fs');
const path = require('path');
const { createMemoryRepository } = require('../services/repository');
const clock = require('../common/clock');
const numberRanges = require('../common/numberRanges');
const { resetProviders } = require('../execution/MockExecutionProvider');

const DATA_DIR = path.join(__dirname, '../../webapp/localService/mainService/data');

function loadAllData() {
    const dataBySet = {};
    for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))) {
        dataBySet[file.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    }
    return dataBySet;
}

let tenantCounter = 0;

/** @returns {{repo: object, tick: Function, tenantId: string}} fresh repository on a fresh tenant with a manual clock */
function setup() {
    tenantCounter++;
    const tenantId = `tenant-test-${tenantCounter}`;
    let time = Date.parse('2026-09-29T09:00:00Z');
    clock.setClock(() => time);
    const repo = createMemoryRepository(loadAllData(), tenantId);
    return {
        repo,
        tenantId,
        tick(ms) {
            time += ms;
        }
    };
}

function teardown(tenantId) {
    clock.resetClock();
    numberRanges.reset(tenantId);
    resetProviders();
}

function pools(repo) {
    const d = repo.data;
    return {
        customers: d.CustomerVH,
        contacts: d.ContactPersonVH,
        functionalLocations: d.FunctionalLocationVH,
        equipments: d.EquipmentVH,
        products: d.ProductVH,
        salesOrganizations: d.SalesOrganizationVH,
        serviceOrganizations: d.ServiceOrganizationVH,
        serviceTeams: d.ServiceTeamVH,
        priorities: d.ServiceDocumentPriorityVH,
        requestTypes: d.ServiceRequestTypeVH,
        units: d.UnitOfMeasureVH,
        currencies: d.CurrencyVH,
        processProfiles: d.ProcessProfileVH
    };
}

/** Golden test case H2-STC-001 (prompt.md, Anhang C) */
const GOLDEN = Object.freeze({
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
});

const GOLDEN_DOCUMENTS = ['8000000010', '8000000030', '8000000031', '9000000000', '10000012', '90000115'];

let uuidCounter = 0;
const newUuid = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;

/** Simulates Create (draft) as the FE mock server does it: initial values, 1:1 test data with the profile defaults */
async function createDraft(repo, processProfile = 'FS_TM', text = '') {
    const service = require('../services/TestCaseService');
    const tc = { TestCaseUUID: newUuid(), IsActiveEntity: false, HasActiveEntity: false, HasDraftEntity: false, NaturalLanguageInput: text };
    Object.assign(tc, service.initialTestCase({ ProcessProfile: processProfile }));
    await repo.add('TestCase', tc);
    await service.createTestData(repo, tc);
    await service.syncDerived(repo, tc.TestCaseUUID);
    return { TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: false };
}

/** Simulates Activate as the FE mock server does it: draft rows are copied to active rows */
async function activate(repo, draftKeys) {
    const service = require('../services/TestCaseService');
    for (const set of ['TestCase', 'TestCaseData', 'ValidationResult']) {
        for (const row of await repo.find(set, { TestCaseUUID: draftKeys.TestCaseUUID, IsActiveEntity: false })) {
            const keyName = set === 'ValidationResult' ? 'ValidationUUID' : 'TestCaseUUID';
            await repo.remove(set, { [keyName]: row[keyName], IsActiveEntity: false });
            await repo.add(set, { ...row, IsActiveEntity: true, HasDraftEntity: false, DraftAdministrativeData: null });
        }
    }
    const keys = { TestCaseUUID: draftKeys.TestCaseUUID, IsActiveEntity: true };
    await service.onActivated(repo, keys);
    await service.syncDerived(repo, keys.TestCaseUUID);
    return keys;
}

module.exports = { setup, teardown, pools, GOLDEN, GOLDEN_DOCUMENTS, loadAllData, createDraft, activate };
