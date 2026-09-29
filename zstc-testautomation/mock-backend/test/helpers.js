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

module.exports = { setup, teardown, pools, GOLDEN, GOLDEN_DOCUMENTS, loadAllData };
