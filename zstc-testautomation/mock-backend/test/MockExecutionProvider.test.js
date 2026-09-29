'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MockExecutionProvider, getProvider } = require('../execution/MockExecutionProvider');
const { setup, teardown, GOLDEN, GOLDEN_DOCUMENTS } = require('./helpers');

function start(provider, data = GOLDEN, processProfile = 'FS_TM') {
    return provider.start({ data, processProfile }, { caseId: 'STC-2026-000007', soldToParty: data.SoldToParty }).externalExecutionId;
}

test('the first run of a session creates exactly the golden document numbers (SIM-2)', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const provider = new MockExecutionProvider({ tenantId });
    const id = start(provider);
    assert.match(id, /^MOCK-20260929-0003$/);
    assert.equal(provider.getStatus(id).status, 'RUNNING');
    assert.deepEqual(provider.getCreatedDocuments(id), [], 'no documents before the steps ran');

    tick(4999);
    const partial = provider.getStatus(id);
    assert.equal(partial.steps.filter((s) => s.status === 'DONE').length, 2);
    assert.equal(partial.steps[2].status, 'RUNNING');

    tick(20000);
    const status = provider.getStatus(id);
    assert.equal(status.status, 'FINISHED');
    assert.equal(status.progressPercent, 100);
    const documents = provider.getCreatedDocuments(id);
    assert.deepEqual(documents.map((d) => d.documentId), GOLDEN_DOCUMENTS);
    assert.deepEqual(documents.map((d) => d.predecessorId), ['', ...GOLDEN_DOCUMENTS.slice(0, 5)]);
    const billing = provider.readDocument('BILLING_DOCUMENT', '90000115');
    assert.equal(billing.TotalNetAmount, 3693);
    assert.equal(billing.SoldToParty, 'C700-C00');
    assert.equal(provider.getResult(id).technicalResult, 'OK');
});

test('a second run continues the number ranges deterministically (DoD-12)', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const provider = new MockExecutionProvider({ tenantId });
    const first = start(provider);
    tick(20000);
    // documents are created when the run is advanced (status polling), numbers follow in creation order
    provider.getStatus(first);
    const second = start(provider);
    tick(20000);
    provider.getStatus(second);
    assert.deepEqual(
        provider.getCreatedDocuments(second).map((d) => d.documentId),
        ['8000000011', '8000000032', '8000000033', '9000000001', '10000013', '90000116']
    );
});

test('SIM-6: a blocked spare part fails the confirmation step and skips the rest', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const provider = new MockExecutionProvider({ tenantId });
    const id = start(provider, { ...GOLDEN, ServicePart: 'P700-SC-999' });
    tick(20000);
    const status = provider.getStatus(id);
    assert.equal(status.status, 'FAILED');
    assert.deepEqual(status.steps.map((s) => s.status), ['DONE', 'DONE', 'DONE', 'FAILED', 'SKIPPED', 'SKIPPED']);
    assert.equal(provider.getResult(id).technicalResult, 'ERROR');
    assert.equal(provider.getCreatedDocuments(id).length, 3);
});

test('SIM-7: cancel stops the run', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const provider = new MockExecutionProvider({ tenantId });
    const id = start(provider);
    tick(3000);
    provider.cancel(id);
    const status = provider.getStatus(id);
    assert.equal(status.status, 'CANCELLED');
    assert.equal(status.steps.filter((s) => s.status === 'SKIPPED').length, 5);
});

test('FS_FIXPRICE: the billing document request follows the service order', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const provider = new MockExecutionProvider({ tenantId });
    const id = start(provider, GOLDEN, 'FS_FIXPRICE');
    tick(20000);
    provider.getStatus(id);
    const bdr = provider.getCreatedDocuments(id).find((d) => d.businessObjectType === 'BILLING_DOC_REQUEST');
    assert.equal(bdr.predecessorId, '8000000031');
});

test('provider registry: MOCK_UNAVAILABLE throws a technical error, unknown providers are not connected', (t) => {
    const { tenantId } = setup();
    t.after(() => teardown(tenantId));
    assert.throws(() => getProvider('MOCK_UNAVAILABLE', tenantId).start({ data: GOLDEN }, {}), /not reachable/);
    assert.equal(getProvider('CALM_TAT', tenantId), undefined);
});
