'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MockTestCaseExtractionService, parseAmount } = require('../extraction/MockTestCaseExtractionService');
const { setup, teardown, pools } = require('./helpers');

const GOLDEN_TEXT =
    'Customer C700-C00 reports "System cooling partially failed" on equipment EL-100 at functional location H2POWC00-PROD. ' +
    'Reporter Michael Fischer, service team ICNT_1SUP-DE, priority medium. Plan on-site service P700_SERV_ONS 3 HR and spare part P700-SC-100 1 PC. ' +
    'Expected net value 3.693 EUR.';

test('parseAmount understands German and English number formats', () => {
    assert.equal(parseAmount('3.693'), 3693);
    assert.equal(parseAmount('3,693.00'), 3693);
    assert.equal(parseAmount('3693,50'), 3693.5);
    assert.equal(parseAmount('3.693,50'), 3693.5);
});

test('golden description yields the golden values without ambiguity', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { proposals } = new MockTestCaseExtractionService().extract(GOLDEN_TEXT, pools(repo));
    const value = (field) => proposals.find((p) => p.field === field)?.value;
    assert.equal(value('SoldToParty'), 'C700-C00');
    assert.equal(value('ServiceRequestReporter'), 'CP-700001');
    assert.equal(value('ServiceReferenceEquipment'), 'EL-100');
    assert.equal(value('ServiceRefFunctionalLocation'), 'H2POWC00-PROD');
    assert.equal(value('RespyMgmtServiceTeam'), 'ICNT_1SUP-DE');
    assert.equal(value('ServiceDocumentPriority'), '5');
    assert.equal(value('ServiceProduct'), 'P700_SERV_ONS');
    assert.equal(Number(value('ServiceDuration')), 3);
    assert.equal(value('ServicePart'), 'P700-SC-100');
    assert.equal(Number(value('ExpectedNetAmount')), 3693);
    assert.equal(value('ServiceRequestDescription'), 'System cooling partially failed');
    assert.deepEqual(proposals.filter((p) => p.status === 'WARNING'), []);
});

test('"Fischer" and "EL-10" are ambiguous and come with candidate lists (DoD-5)', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { proposals } = new MockTestCaseExtractionService().extract('Reporter Fischer, equipment EL-10 cooling issue', pools(repo));
    const reporter = proposals.find((p) => p.field === 'ServiceRequestReporter');
    assert.equal(reporter.status, 'WARNING');
    assert.ok(reporter.candidates.length >= 2);
    const equipment = proposals.find((p) => p.field === 'ServiceReferenceEquipment');
    assert.equal(equipment.status, 'WARNING');
    assert.deepEqual(equipment.candidates.slice(0, 2), ['EL-100', 'EL-101']);
});

test('unknown words produce no proposals (no invented values)', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { proposals } = new MockTestCaseExtractionService().extract('Something is broken somewhere.', pools(repo));
    assert.deepEqual(proposals, []);
});
