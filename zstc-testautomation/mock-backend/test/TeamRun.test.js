'use strict';
/**
 * Team run ("run all test cases of a process team", e.g. after a code change), the duplicate rule R13 and the generated
 * master data / test case portfolio.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/TestCaseService');
const releaseService = require('../services/ReleaseService');
const { setup, teardown, createDraft } = require('./helpers');
const { generate, CUSTOMERS } = require('../../tools/seed/generate-masterdata');

const IN_TEST = { ReleaseID: 'INT-2026.10', IsActiveEntity: true };

test('team run: only the test cases of the process team, with the reason; skip reasons as in a regression run', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const { run, messages } = await releaseService.startTeamRegressionRun(repo, IN_TEST, {
        ProcessTeam: 'PT-REPARATUR',
        ProcessID: 'SRV-REP',
        RunReason: 'Code-Änderung im Reparaturprozess'
    });
    assert.equal(run.Trigger, 'TEAM_RUN');
    assert.equal(run.ProcessTeam, 'PT-REPARATUR');
    assert.equal(run.RunReason, 'Code-Änderung im Reparaturprozess');
    assert.match(messages[0].message, /^Team run REG-INT-2026\.10-01 of PT-REPARATUR \(SRV-REP\)/);
    const items = await repo.find('RegressionRunItem', { RunUUID: run.RunUUID });
    assert.ok(items.every((i) => i.ProcessTeam === 'PT-REPARATUR'), 'no test case of another team');
    // 16 test cases of the team: STC-1 … 11 (without STC-2, no process assignment), STC-13 and the generated STC-15 … 19
    assert.equal(items.length, 16);
    const byCase = Object.fromEntries(items.map((i) => [i.CaseID, i]));
    assert.equal(byCase['STC-2026-000015'].Decision, 'STARTED', 'generated and approved');
    assert.equal(byCase['STC-2026-000003'].Decision, 'SKIPPED');
    assert.ok(!byCase['STC-2026-000014'], 'dependent test case of the end-to-end team only on request');

    // the run is the release's latest run: the refresh advances it (no waiting test case: finished at once)
    tick(60000);
    const { messages: finished } = await releaseService.refreshRegressionRun(repo, IN_TEST);
    assert.match(finished[0].message, /^Team run REG-INT-2026\.10-01 finished: 10 passed, 1 failed, 5 skipped \(pass rate 91 %\)/);
    const failed = (await repo.find('RegressionRunItem', { RunUUID: run.RunUUID })).filter((i) => i.FinalResult === 'FAILED_FUNCTIONAL');
    assert.deepEqual(
        failed.map((i) => i.CaseID),
        ['STC-2026-000007'],
        'the second version of STC-7 (2 hours, expectation not adapted) fails again'
    );
});

test('team run with dependent test cases: the end-to-end team waits for the confirmation of the repair team', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const { run } = await releaseService.startTeamRegressionRun(repo, IN_TEST, { ProcessTeam: 'PT-REPARATUR', IncludeDependents: true, RunReason: 'Transport mit Coding-Änderung' });
    assert.equal(run.IncludesDependents, true);
    const items = await repo.find('RegressionRunItem', { RunUUID: run.RunUUID });
    const dependent = items.find((i) => i.CaseID === 'STC-2026-000014');
    assert.equal(dependent.ProcessTeam, 'PT-E2E');
    assert.equal(dependent.Decision, 'WAITING');
    assert.ok(!items.some((i) => i.CaseID === 'STC-2026-000021'), 'other test cases of the end-to-end team stay out');
    tick(60000);
    await releaseService.refreshRegressionRun(repo, IN_TEST);
    const started = (await repo.find('RegressionRunItem', { RunUUID: run.RunUUID })).find((i) => i.CaseID === 'STC-2026-000014');
    assert.equal(started.Decision, 'STARTED');
});

test('team run: checks of team, process and scope', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    await assert.rejects(releaseService.startTeamRegressionRun(repo, IN_TEST, {}), (error) => error.number === 255);
    await assert.rejects(releaseService.startTeamRegressionRun(repo, IN_TEST, { ProcessTeam: 'PT-UNKNOWN' }), (error) => error.number === 256);
    await assert.rejects(releaseService.startTeamRegressionRun(repo, IN_TEST, { ProcessTeam: 'PT-REPARATUR', ProcessID: 'XYZ' }), (error) => error.number === 257);
    // the repair team is not in the scope with the assembly process
    await assert.rejects(releaseService.startTeamRegressionRun(repo, IN_TEST, { ProcessTeam: 'PT-REPARATUR', ProcessID: 'MON' }), (error) => error.number === 254);
    await assert.rejects(
        releaseService.startTeamRegressionRun(repo, { ReleaseID: 'S4-2025-FPS02', IsActiveEntity: true }, { ProcessTeam: 'PT-REPARATUR' }),
        (error) => error.number === 251,
        'only releases in test'
    );
    const release = await repo.findOne('Release', IN_TEST);
    assert.equal(releaseService.deriveRelease(release).__OperationControl.startTeamRegressionRun, true);
});

test('rule R13: a test case of the same section with the same device is a possible duplicate (information, not blocking)', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const keys = await createDraft(repo, 'MD_HKV_STOER');
    // same way, start and end as the generated STC-2026-000015 with the same heat cost allocator
    await repo.update('TestCase', keys, { ProcessTeam: 'PT-REPARATUR', BusinessProcess: 'SRV-REP', ProcessVariant: 'W1_REQUEST', EndObject: 'ACCOUNTING_DOCUMENT' });
    await service.onProcessReferenceChanged(repo, keys, ['ProcessTeam', 'ProcessVariant', 'EndObject']);
    await repo.update('TestCaseData', keys, {
        ServiceReferenceEquipment: 'HKV-5101-011',
        ServiceRequestDescription: 'HKV Wohnzimmer: Display ohne Anzeige',
        ServiceRequestReporter: 'MD-CP-4011',
        RespyMgmtServiceTeam: 'MD-TEAM-BRE'
    });
    await service.onTestDataChanged(repo, keys, ['ServiceReferenceEquipment', 'ServiceRequestDescription', 'ServiceRequestReporter', 'RespyMgmtServiceTeam']);
    const { result } = await service.validateTestCase(repo, keys);
    const duplicate = result.items.find((i) => i.RuleID === 'R13_DUPLICATE');
    assert.equal(duplicate.ValidationStatus, 'INFO');
    assert.match(duplicate.ValidationMessage, /STC-2026-000015 already tests way W1_REQUEST from Service Request to Accounting Document with equipment HKV-5101-011/);
    assert.equal(result.overall, 'VALID', 'a hint, not a blocker');

    // another device of the same unit: no duplicate
    await repo.update('TestCaseData', keys, { ServiceReferenceEquipment: 'HKV-5101-012', ReferenceProduct: null });
    await service.onTestDataChanged(repo, keys, ['ServiceReferenceEquipment']);
    const { result: other } = await service.validateTestCase(repo, keys);
    assert.ok(!other.items.some((i) => i.RuleID === 'R13_DUPLICATE'));
});

test('generated master data: deterministic, fictional, consistent relations and unique regional service teams', () => {
    const first = generate();
    assert.deepEqual(generate(), first, 'deterministic');
    assert.equal(first.CustomerVH.length, CUSTOMERS.length);
    assert.ok(first.CustomerVH.every((c) => /^MD-2\d{5}$/.test(c.Customer)));
    const locations = new Map(first.FunctionalLocationVH.map((f) => [f.FunctionalLocation, f]));
    for (const equipment of first.EquipmentVH) {
        const unit = locations.get(equipment.FunctionalLocation);
        assert.ok(unit && unit.SuperiorFunctionalLocation, `${equipment.Equipment} sits in a usage unit`);
        assert.equal(unit.Customer, equipment.Customer);
    }
    assert.equal(new Set(first.EquipmentVH.map((e) => e.Equipment)).size, first.EquipmentVH.length, 'unique equipment');
    for (const customer of first.CustomerVH) {
        const teams = first.ServiceTeamVH.filter((t) => t.RespyMgmtServiceTeamName.toLowerCase().includes(customer.CityName.toLowerCase()));
        assert.equal(teams.length, 1, `one service team for ${customer.CityName}`);
        assert.equal(first.ContactPersonVH.filter((c) => c.Customer === customer.Customer).length, 2);
    }
    const contracts = first.ServiceContractVH;
    assert.ok(contracts.some((c) => !c.ServiceContractIsReleased), 'one contract in preparation');
    assert.ok(contracts.some((c) => c.ServiceContractEndDate < '2026-10-01'), 'one expired contract');
    assert.ok(contracts.every((c) => locations.get(c.ServiceRefFunctionalLocation) && !locations.get(c.ServiceRefFunctionalLocation).SuperiorFunctionalLocation), 'contracts cover properties');
});
