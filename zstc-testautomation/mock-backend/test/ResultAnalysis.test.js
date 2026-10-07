'use strict';
/**
 * Result analysis of finished runs: deterministic causes from the evidence of the run, responsible team,
 * recommendation, confidence and the comparison with the previous run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/TestCaseService');
const { setup, teardown, GOLDEN, createDraft, activate } = require('./helpers');

const W1_FI = { TestCaseUUID: '6f1c2a10-0007-4c3e-9a51-000000000007', IsActiveEntity: true };

async function findings(repo, executionUUID) {
    return (await repo.find('ResultFinding', { ExecutionUUID: executionUUID, IsActiveEntity: true })).sort((a, b) => a.Sequence - b.Sequence);
}

test('seed STC-7, second run: the deviation equals one hour of the service product; regression since version 1', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const tc = await repo.findOne('TestCase', W1_FI);
    assert.equal(tc.FinalResult, 'FAILED_FUNCTIONAL');
    const rows = await findings(repo, tc.LatestExecutionUUID);
    const deviation = rows.find((f) => f.FindingCode === 'NET_VALUE_DEVIATION');
    assert.equal(deviation.Severity, 'ERROR');
    assert.equal(deviation.Confidence, 'HIGH');
    assert.equal(deviation.ResponsibleTeam, 'PT-REPARATUR', 'test data and expectation belong to the team of the test case');
    assert.match(deviation.ProbableCause, /differs by 1 hour of MD-SRV-STOER/);
    assert.match(deviation.Recommendation, /set the expected net value to 183.00 EUR/);
    assert.deepEqual(JSON.parse(deviation.Parameters), {
        expected: 114,
        actual: 183,
        delta: 69,
        tolerance: 0,
        object: 'BILLING_DOCUMENT',
        priceList: 183,
        explained: { product: 'MD-SRV-STOER', quantity: 1, unit: 'HR', price: 69 }
    });
    const regression = rows.find((f) => f.FindingCode === 'REGRESSION');
    assert.match(regression.ProbableCause, /test case version 2: Changed: ServiceDuration/);
    const execution = await repo.findOne('Execution', { ExecutionUUID: tc.LatestExecutionUUID, IsActiveEntity: true });
    assert.match(execution.AnalysisHeadline, /^FAILED_FUNCTIONAL: The documents are priced exactly as the test data says/);
});

test('technical failure: blocked spare part (SIM-6) is named with the step of the confirmation and its team', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo);
    await repo.update('TestCaseData', draft, { ...GOLDEN, ServicePart: 'P700-SC-999', ExpectedNetAmount: 3999 });
    await service.validateTestCase(repo, draft);
    const active = await activate(repo, draft);
    await service.approve(repo, active);
    const started = await service.startExecution(repo, active);
    tick(20000);
    await service.refreshExecution(repo, active);
    const rows = await findings(repo, started.testCase.LatestExecutionUUID);
    const blocked = rows.find((f) => f.FindingCode === 'MATERIAL_BLOCKED');
    assert.equal(blocked.Category, 'TECHNICAL');
    assert.equal(blocked.ProcessStepID, 'REP-080');
    assert.equal(blocked.ResponsibleTeam, 'PT-REPARATUR');
    assert.match(blocked.Recommendation, /Unblock P700-SC-999/);
    assert.equal(rows[0].FindingCode, 'MATERIAL_BLOCKED', 'errors first');
});

test('blocked run: no valid service contract is a missing precondition, not a technical error', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    // way 3 test case, its contract expires before the run
    const keys = { TestCaseUUID: '6f1c2a10-0010-4c3e-9a51-000000000010', IsActiveEntity: true };
    await repo.update('ServiceContractVH', { ServiceContract: '4100000001' }, { ServiceContractEndDate: '2026-06-30' });
    const started = await service.startExecution(repo, keys);
    tick(20000);
    const finished = await service.refreshExecution(repo, keys);
    assert.equal(finished.testCase.FinalResult, 'BLOCKED');
    const contract = (await findings(repo, started.testCase.LatestExecutionUUID)).find((f) => f.FindingCode === 'CONTRACT_INVALID');
    assert.equal(contract.Category, 'PRECONDITION');
    assert.equal(JSON.parse(contract.Parameters).reason, 'expired or not yet valid');
    assert.match(contract.Recommendation, /Extend or release the contract/);
});

test('a deviation that persists: same result as the previous run, regression since the last passed run', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    // third run of STC-7 (version 2, expectation still not updated), after the seeded second run of 01.10.2026
    tick(3 * 24 * 3600 * 1000);
    const started = await service.startExecution(repo, W1_FI);
    tick(20000);
    const finished = await service.refreshExecution(repo, W1_FI);
    assert.equal(finished.testCase.FinalResult, 'FAILED_FUNCTIONAL');
    const rows = await findings(repo, started.testCase.LatestExecutionUUID);
    assert.deepEqual(
        rows.map((f) => f.FindingCode),
        ['NET_VALUE_DEVIATION', 'REGRESSION', 'SAME_AS_BEFORE']
    );
    const same = rows.find((f) => f.FindingCode === 'SAME_AS_BEFORE');
    assert.match(same.Finding, /Same result as the previous run MOCK-20261001-0007/);
    const regression = rows.find((f) => f.FindingCode === 'REGRESSION');
    assert.match(regression.Finding, /the last passed run MOCK-20260928-0003 \(release INT-2026.10\) used version 1/);
    assert.match(regression.ProbableCause, /test case version 2: Changed: ServiceDuration/);
    assert.equal(JSON.parse(regression.Parameters).lastPassed, true);
});
