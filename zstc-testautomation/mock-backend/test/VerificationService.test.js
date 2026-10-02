'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verify } = require('../verification/VerificationService');
const { MockExecutionProvider } = require('../execution/MockExecutionProvider');
const { setup, teardown, GOLDEN } = require('./helpers');

/** Runs the mock chain with the given ACTUAL data and verifies against the EXPECTED data */
function runAndVerify(tick, tenantId, { expected = GOLDEN, actual = GOLDEN, cancelAfterMs } = {}) {
    const provider = new MockExecutionProvider({ tenantId });
    const { externalExecutionId: id } = provider.start({ data: actual, processProfile: 'FS_TM' }, { caseId: 'STC-2026-000013' });
    if (cancelAfterMs !== undefined) {
        tick(cancelAfterMs);
        provider.cancel(id);
    } else {
        tick(20000);
    }
    const status = provider.getStatus(id);
    const result = provider.getResult(id);
    return verify({
        data: expected,
        documents: provider.getCreatedDocuments(id),
        readDocument: (type, docId) => provider.readDocument(type, docId),
        steps: status.steps,
        executionStatus: status.status,
        technicalResult: result.technicalResult
    });
}

test('PASSED: all assertions pass for the golden case', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const { finalResult, assertions } = runAndVerify(tick, tenantId);
    assert.equal(finalResult, 'PASSED');
    assert.deepEqual([...new Set(assertions.map((a) => a.Result))], ['PASSED']);
    const net = assertions.find((a) => a.Field === 'NetValue');
    assert.equal(net.ExpectedValue, '3,693.00 EUR');
    assert.equal(net.ActualValue, '3,693.00 EUR');
    assert.ok(assertions.find((a) => a.Field === 'DocumentFlow'));
});

test('PASSED_WITH_WARNING: expectation 3,690.00 EUR with tolerance 5.00 EUR', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const expected = { ...GOLDEN, ExpectedNetAmount: 3690, NetAmountTolerance: 5 };
    const { finalResult, assertions } = runAndVerify(tick, tenantId, { expected, actual: expected });
    assert.equal(finalResult, 'PASSED_WITH_WARNING');
    assert.equal(assertions.find((a) => a.Field === 'NetValue').Result, 'WARNING');
});

test('FAILED_FUNCTIONAL: 4 HR instead of 3 HR with an unchanged expectation', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const data = { ...GOLDEN, ServiceDuration: 4 };
    const { finalResult, assertions } = runAndVerify(tick, tenantId, { expected: data, actual: data });
    assert.equal(finalResult, 'FAILED_FUNCTIONAL');
    const net = assertions.find((a) => a.Field === 'NetValue');
    assert.equal(net.Result, 'FAILED');
    assert.equal(net.ActualValue, '4,693.00 EUR');
});

test('FAILED_TECHNICAL: blocked spare part (SIM-6)', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const data = { ...GOLDEN, ServicePart: 'P700-SC-999' };
    const { finalResult, assertions } = runAndVerify(tick, tenantId, { expected: data, actual: data });
    assert.equal(finalResult, 'FAILED_TECHNICAL');
    assert.ok(assertions.some((a) => a.Result === 'NOT_EVALUATED'));
});

test('BLOCKED: cancelled execution (SIM-7)', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const { finalResult } = runAndVerify(tick, tenantId, { cancelAfterMs: 3000 });
    assert.equal(finalResult, 'BLOCKED');
});

test('verification compares expected with actual: a deviating document fails the assertion', (t) => {
    const { tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const { finalResult, assertions } = runAndVerify(tick, tenantId, { expected: GOLDEN, actual: { ...GOLDEN, ServicePart: 'P700-SC-110' } });
    assert.equal(finalResult, 'FAILED_FUNCTIONAL');
    assert.equal(assertions.find((a) => a.Field === 'ServicePart').Result, 'FAILED');
});
