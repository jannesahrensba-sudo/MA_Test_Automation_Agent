'use strict';
/**
 * Analytics page (webapp/ext/analytics/dashboardModel.js) on the seed data of release INT-2026.10: key figures, results
 * per process team, coverage along the process, failure patterns from the result analysis and the pass rate over time.
 */
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi5Module, setup, teardown } = require('./helpers');

const dashboardModel = loadUi5Module(path.join(__dirname, '../../webapp/ext/analytics/dashboardModel'));
const text = (key, args) => (args ? `${key}:${args.join('|')}` : key);

function input(repo, releaseId, german) {
    const d = repo.data;
    const teams = new Map(d.ProcessTeamVH.map((t) => [t.ProcessTeam, t.ProcessTeamName]));
    return {
        release: d.Release.find((r) => r.ReleaseID === releaseId && r.IsActiveEntity),
        scopes: d.ReleaseScope.filter((s) => s.ReleaseID === releaseId && s.IsActiveEntity),
        cases: d.ReleaseTestCase.filter((c) => c.ReleaseID === releaseId),
        coverage: d.ReleaseStepCoverage.filter((c) => c.ReleaseID === releaseId),
        executions: d.Execution.filter((e) => e.ReleaseID === releaseId && e.IsActiveEntity),
        findings: d.ResultFinding.filter((f) => f.ReleaseID === releaseId && f.IsActiveEntity),
        runs: d.RegressionRun.filter((r) => r.ReleaseID === releaseId),
        text,
        teamName: (team) => teams.get(team) || team,
        german
    };
}

test('release in test: key figures, distribution, teams and the pass rate over time', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const data = dashboardModel.build(input(repo, 'INT-2026.10', true));
    assert.deepEqual(
        { inScope: data.kpis.inScope, executed: data.kpis.executed, passed: data.kpis.passed, failed: data.kpis.failed, passRate: data.kpis.passRate, open: data.kpis.openFindings },
        { inScope: 20, executed: 6, passed: 5, failed: 1, passRate: 83, open: 2 }
    );
    assert.equal(data.kpis.stepCoverage, 75);
    // 20 test cases in scope: 13 hand-written seed cases and the generated portfolio STC-2026-000015 … 000021 (not executed yet)
    assert.deepEqual(data.distribution.map((s) => s.value), [5, 1, 14]);

    const repair = data.teams.find((team) => team.team === 'PT-REPARATUR');
    assert.deepEqual({ total: repair.total, passed: repair.passed, failed: repair.failed, open: repair.notExecuted, state: repair.state }, { total: 16, passed: 4, failed: 1, open: 11, state: 'Error' });
    const e2e = data.teams.find((team) => team.team === 'PT-E2E');
    assert.equal(e2e.name, 'Prozessteam New End to End Prozess');
    // STC-2026-000014 passed, the generated STC-2026-000021 is not executed yet
    assert.equal(e2e.state, 'Information');
    assert.equal(e2e.status, 'analyticsTeamOpen:1');
    const montage = data.teams.find((team) => team.team === 'PT-MONTAGE');
    assert.equal(montage.status, 'analyticsTeamNoCases:MON');
    assert.deepEqual(montage.bars, []);

    // 28.09.: 4 runs passed, 29.09.: handover runs passed, 01.10.: the second run of STC-2026-000007 fails
    assert.deepEqual(
        data.trend.map((p) => [p.label, p.value]),
        [
            ['28.09.', 100],
            ['29.09.', 100],
            ['01.10.', 83]
        ]
    );
    assert.equal(data.trend[2].color, 'Critical');
});

test('failure patterns and failed test cases carry the analysis and the jump-off to the assistant', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const stc7 = repo.data.TestCase.find((tc) => tc.CaseID === 'STC-2026-000007' && tc.IsActiveEntity);
    const german = dashboardModel.build(input(repo, 'INT-2026.10', true));
    assert.deepEqual(german.patterns.map((p) => [p.code, p.count, p.cases]), [
        ['NET_VALUE_DEVIATION', 1, 'STC-2026-000007'],
        ['REGRESSION', 1, 'STC-2026-000007']
    ]);
    const net = german.patterns[0];
    assert.equal(net.title, 'findingNET_VALUE_DEVIATION');
    assert.equal(net.step, 'REP-100 Faktura (SD) erzeugen');
    assert.equal(net.team, 'Prozessteam Reparatur');
    assert.equal(net.confidence, 'confidenceHIGH');
    assert.match(net.example, /Nettowert 183,00 EUR statt 114,00 EUR/);
    assert.match(net.cause, /weicht um 1 Std\. MD-SRV-STOER/);
    assert.equal(net.testCaseUUID, stc7.TestCaseUUID);
    assert.equal(net.run, 'MOCK-20261001-0007', 'the jump-off discusses the run shown for this release');
    assert.equal(german.patterns[1].team, 'analyticsNoTeam');

    assert.equal(german.failedCases.length, 1);
    assert.equal(german.failedCases[0].caseId, 'STC-2026-000007');
    assert.equal(german.failedCases[0].resultText, 'resultFAILED_FUNCTIONAL');
    assert.match(german.failedCases[0].headline, /Die Belege sind genau so bepreist/);

    // English UI: the texts of the backend analysis
    const english = dashboardModel.build(input(repo, 'INT-2026.10', false));
    assert.match(english.patterns[0].example, /^Net value 183\.00 EUR instead of 114\.00 EUR/);
    assert.match(english.failedCases[0].headline, /The documents are priced exactly as the test data says/);
});

test('coverage along the process: only the failing step is red, a planned release has no results', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const data = dashboardModel.build(input(repo, 'INT-2026.10', true));
    const failed = data.steps.filter((s) => s.status === 'FAILED').map((s) => s.stepId);
    assert.deepEqual(failed, ['REP-100'], 'a deviation in billing is not a failure of the decision before it');
    assert.equal(data.steps.find((s) => s.stepId === 'REP-020').status, 'PASSED');
    assert.equal(data.steps.find((s) => s.stepId === 'REP-100').counts, 'analyticsStepCounts:3|1|15');
    assert.equal(data.steps.find((s) => s.stepId === 'REP-200').state, 'None');

    const planned = dashboardModel.build(input(repo, 'S4-2025-FPS02', true));
    assert.equal(planned.hasResults, false);
    assert.deepEqual(planned.trend, []);
    assert.deepEqual(planned.patterns, []);
});
