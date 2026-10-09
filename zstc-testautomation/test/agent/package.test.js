'use strict';
/**
 * Service assistant: test package from the process description ("Leg mir für das nächste Release Testfälle an") and team
 * run ("Ich habe im Coding etwas angepasst – nimm alle Testfälle des Prozessteams vor") against the mock backend services.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, createMemoryGateway, setup, teardown, loadUi5Module } = require('./helpers');
const path = require('path');

const AgentSession = core('AgentSession');
const testPackage = core('testPackage');
const teamRun = core('teamRun');
const testDesign = core('testDesign');
const catalog = require('../../mock-backend/process/processCatalog');

const TEXT_PACKAGE = 'Zum nächsten Release möchte ich jeden Prozess durchtesten. Leg mir dafür Testfälle an, welche auf die Prozessbeschreibung passen.';
const TEXT_TEAM_RUN = 'Möchte den Standardreparaturprozess testen, habe dort was im coding angepasst. Nimm alle testcases die dem Prozessteam zugeordnet sind vor.';

function newSession(repo) {
    const gateway = createMemoryGateway(repo);
    const steps = [];
    const packages = [];
    const runs = [];
    const session = new AgentSession({
        gateway,
        transport: { kind: 'rules' },
        onStep: (s) => steps.push(s),
        onPackage: (p) => packages.push(p),
        onRun: (r) => runs.push(r),
        today: () => '2026-10-09'
    });
    return { session, gateway, steps, packages, runs };
}

test('requests: test package and team run are told apart from fault reports', () => {
    assert.equal(testPackage.isRequest(TEXT_PACKAGE), true);
    assert.equal(teamRun.isRequest(TEXT_PACKAGE), false);
    assert.equal(teamRun.isRequest(TEXT_TEAM_RUN), true);
    assert.equal(testPackage.isRequest(TEXT_TEAM_RUN), false);
    assert.equal(testPackage.isRequest('Bitte lege Testfälle für den Reparaturprozess im Release S4-2025-FPS03 an'), true);
    assert.equal(teamRun.isRequest('Lass alle Testfälle des Teams Angebot laufen'), true);
    assert.equal(teamRun.isRequest('Regression für das Prozessteam E2E starten'), true);
    const report = 'Frau Müller aus der Musterstraße 12 meldet, dass der Heizkostenverteiler im Wohnzimmer nichts mehr anzeigt.';
    assert.equal(testPackage.isRequest(report), false);
    assert.equal(teamRun.isRequest(report), false);
});

test('team run request: process, owner team, reason and dependents from German wording', () => {
    const data = require('./helpers').loadAllData();
    const catalogRows = { processes: data.BusinessProcessVH, teams: data.ProcessTeamVH };
    const parsed = teamRun.parse(TEXT_TEAM_RUN, catalogRows);
    assert.deepEqual(
        { team: parsed.team, processId: parsed.processId, reason: parsed.reason, includeDependents: parsed.includeDependents },
        { team: 'PT-REPARATUR', processId: 'SRV-REP', reason: 'Code-Änderung: habe dort was im coding angepasst', includeDependents: false }
    );
    assert.equal(teamRun.parse('Alle Testfälle des Teams Angebot ausführen', catalogRows).team, 'PT-ANGEBOT');
    assert.equal(teamRun.parse('Regression für das Team E2E starten, mit abhängigen Testfällen', catalogRows).team, 'PT-E2E');
    assert.equal(teamRun.parse('Regression für das Team E2E starten, mit abhängigen Testfällen', catalogRows).includeDependents, true);
});

test('test design: the R12 rule of the assistant is the rule of the backend', () => {
    const data = require('./helpers').loadAllData();
    const steps = data.ProcessStepVH;
    for (const variant of ['W1_REQUEST', 'W2_QUOTATION', 'W2_REJECTED', 'W3_CONTRACT', 'W3_BILLING_PLAN']) {
        for (const start of catalog.DOCUMENT_ORDER) {
            assert.equal(testDesign.requiredPredecessor(testDesign.wayPath(steps, variant), start), catalog.requiredPredecessor(steps, variant, start), `${variant} ${start}`);
        }
    }
});

test('test package for the next release: one test case per pilot way and per team, validated, the package checked, then saved', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session, gateway, steps, packages } = newSession(repo);
    const answer = await session.send(TEXT_PACKAGE);
    const pkg = session.package;
    assert.equal(pkg.release.ReleaseID, 'S4-2025-FPS02', 'the next planned release');
    assert.equal(pkg.copyFrom, 'INT-2026.10', 'the scope of FPS02 is still empty');
    assert.deepEqual(
        pkg.items.map((i) => [i.proposal.scenarioId, i.proposal.team, i.proposal.variant, i.status]),
        [
            ['FPS02-W1', 'PT-REPARATUR', 'W1_REQUEST', 'VALID'],
            ['FPS02-W2', 'PT-REPARATUR', 'W2_QUOTATION', 'VALID'],
            ['FPS02-W2R', 'PT-REPARATUR', 'W2_REJECTED', 'VALID'],
            ['FPS02-W3', 'PT-REPARATUR', 'W3_CONTRACT', 'VALID'],
            ['FPS02-W3RP', 'PT-REPARATUR', 'W3_BILLING_PLAN', 'VALID'],
            ['FPS02-ANGEBOT', 'PT-ANGEBOT', 'W2_QUOTATION', 'VALID'],
            ['FPS02-E2E', 'PT-E2E', 'W3_BILLING_PLAN', 'VALID']
        ]
    );
    // other devices than the existing test cases: no duplicate; the ways are already tested by the generated portfolio
    assert.ok(pkg.items.every((i) => i.duplicateOf.length === 0));
    assert.deepEqual(pkg.items[0].proposal.overlaps.map((o) => o.CaseID), ['STC-2026-000007', 'STC-2026-000015']);
    // the backend derived the section: the full way up to FI, the end-to-end team from the billing document request
    assert.deepEqual(pkg.items[0].steps, ['REP-010', 'REP-020', 'REP-060', 'REP-070', 'REP-080', 'REP-090', 'REP-100', 'REP-110']);
    assert.deepEqual(pkg.items[6].steps, ['REP-050', 'REP-095', 'REP-100', 'REP-110']);
    const v = pkg.validation;
    assert.deepEqual({ covered: v.coverage.covered, total: v.coverage.total, missingWays: v.ways.missing.length, teamsWithout: v.teams.without }, { covered: 11, total: 11, missingWays: 0, teamsWithout: [] });
    // assembly, quotation process and meter reading have no process steps: reported, no invented test case
    assert.deepEqual(pkg.skipped.filter((s) => s.reason === 'NOT_MODELED').map((s) => s.id).sort(), ['ABL', 'ANG', 'MON']);
    assert.deepEqual(pkg.skipped.filter((s) => s.reason === 'LATER').map((s) => s.id), ['WARRANTY', 'REQUOTE', 'IN_HOUSE_REPAIR', 'SOLUTION_QUOTATION']);
    assert.match(answer.text, /S4-2025-FPS02/);
    assert.match(answer.text, /11 von 11 automatisierten Prozessschritten/);
    assert.match(answer.text, /\*\*Montageprozess\*\* \(MON\)/);
    assert.match(answer.text, /noch nicht modelliert/);
    assert.match(answer.text, /übernehme ich ihn aus INT-2026\.10/);
    assert.ok(packages.length >= 7, 'the panel follows every draft');
    assert.ok(steps.some((s) => /^Paket geprüft: 11\/11/.test(s.text)));

    // panel data: every draft with its way and the section for the process picture
    const md = await gateway.masterData();
    const panel = testPackage.panel(pkg, md.describe);
    assert.equal(panel.items.length, 7);
    assert.equal(panel.items[5].startObject, 'SERVICE_QUOTATION');
    assert.equal(panel.copyText, 'Scope aus INT-2026.10 übernehmen');

    // deselect one draft, save the package: approval only where the user is process owner (team repair)
    session.selectPackageItem('WAY-W2_REJECTED', false);
    assert.equal(session.package.validation.ways.missing.length, 1);
    const saved = await session.savePackage({ approve: true, copyScope: true });
    assert.equal(saved.saved, true);
    const ids = saved.items.filter((i) => i.saved).map((i) => i.caseId);
    assert.deepEqual(ids, ['STC-2026-000022', 'STC-2026-000023', 'STC-2026-000024', 'STC-2026-000025', 'STC-2026-000026', 'STC-2026-000027']);
    assert.equal(saved.items.find((i) => i.proposal.key === 'WAY-W2_REJECTED').discarded, true);
    assert.deepEqual(
        saved.items.filter((i) => i.saved).map((i) => i.approved === true),
        [true, true, true, true, false, false],
        'quotation and end-to-end team: approval by their process owners'
    );
    assert.match(saved.items.find((i) => i.proposal.team === 'PT-ANGEBOT').approvalMessage, /Prozessverantwortung von Prozessteam Angebot/);
    assert.equal((await repo.find('ReleaseScope', { ReleaseID: 'S4-2025-FPS02', IsActiveEntity: true })).length, 6, 'scope copied from INT-2026.10');
    assert.equal((await repo.find('TestCase', { IsActiveEntity: false })).length, 0, 'no draft left');
    assert.match(testPackage.savedReport(saved), /Testpaket gespeichert: 6 Testfälle/);
});

test('test package of one process for a named release via the tool of the language model', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session } = newSession(repo);
    const tool = session.tools.find((x) => x.name === 'testpaket_entwerfen');
    const result = await tool.execute({ release: 'INT-2026.12', prozesse: ['SRV-REP'], teilprozesse: false });
    assert.equal(result.release, 'INT-2026.12');
    assert.equal(result.testfaelle.length, 5, 'one test case per pilot way, no sub-processes');
    assert.deepEqual(result.pruefung.teams_ohne_testfall, ['PT-ANGEBOT', 'PT-E2E'], 'the check names the teams without own test case');
    assert.match(result.hinweis, /Paket speichern/);
    const processTool = session.tools.find((x) => x.name === 'prozessmodell_lesen');
    const processes = await processTool.execute({});
    const montage = processes.prozesse.find((p) => p.prozess === 'MON');
    assert.equal(montage.modelliert, false);
    const repair = processes.prozesse.find((p) => p.prozess === 'SRV-REP');
    assert.ok(repair.wege.find((w) => w.weg === 'W1_REQUEST').testfaelle.some((c) => c.startsWith('STC-2026-000007')));
    await session.discardPackage();
    assert.equal((await repo.find('TestCase', { IsActiveEntity: false })).length, 0, 'discarding removes the drafts');
});

test('team run after a code change: preview, dependents on request, start on confirmation, result with the failed test case', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const { session, gateway, runs } = newSession(repo);
    const answer = await session.send(TEXT_TEAM_RUN);
    const run = session.run;
    assert.deepEqual({ team: run.team, processId: run.processId, release: run.release.ReleaseID, phase: run.phase }, { team: 'PT-REPARATUR', processId: 'SRV-REP', release: 'INT-2026.10', phase: 'PREVIEW' });
    assert.deepEqual(run.preview.counts, { total: 16, run: 11, skip: 5, wait: 0 });
    assert.deepEqual(run.preview.dependents.map((d) => d.caseId), ['STC-2026-000014']);
    assert.match(answer.text, /Teamlauf vorbereitet: \*\*Prozessteam Reparatur\*\* · Service-Reparaturprozess · Release \*\*INT-2026\.10\*\*/);
    assert.match(answer.text, /Anlass: Code-Änderung: habe dort was im coding angepasst/);
    assert.match(answer.text, /STC-2026-000003 übersprungen: Testdaten nicht gültig/);
    assert.match(answer.text, /Teamlauf starten/);
    assert.equal(gateway.calls.filter((c) => c[0] === 'startTeamRun').length, 0, 'nothing started without confirmation');

    const followUp = await session.send('Bitte mit abhängigen Testfällen');
    assert.match(followUp.text, /Mitgenommen sind die abhängigen Testfälle anderer Teams: STC-2026-000014/);
    assert.equal(session.run.preview.items.find((i) => i.caseId === 'STC-2026-000014').decision, 'WAIT');

    const started = await session.startTeamRun();
    assert.equal(started.phase, 'RUNNING');
    assert.deepEqual(gateway.calls.find((c) => c[0] === 'startTeamRun').slice(1), [
        'INT-2026.10',
        { ProcessTeam: 'PT-REPARATUR', ProcessID: 'SRV-REP', RunReason: 'Code-Änderung: habe dort was im coding angepasst', IncludeDependents: true }
    ]);
    assert.equal(started.run.ProcessTeam, 'PT-REPARATUR');
    tick(60000);
    await session.refreshTeamRun();
    tick(60000);
    const finished = await session.refreshTeamRun();
    assert.equal(finished.phase, 'FINISHED');
    assert.deepEqual({ passed: finished.run.PassedCount, failed: finished.run.FailedCount, skipped: finished.run.SkippedCount }, { passed: 11, failed: 1, skipped: 5 });
    const md = await gateway.masterData();
    const report = teamRun.resultReport(finished, md.describe);
    assert.match(report, /\*\*STC-2026-000007\*\* Weg 1 bis FI: Warmwasserzähler ohne Anzeige – fachlich fehlgeschlagen/);
    assert.match(report, /STC-2026-000003 \(Testdaten nicht validiert – erst validieren\); STC-2026-000004 \(nicht freigegeben\)/, 'German skip reasons');
    const panel = teamRun.panel(finished, md.describe);
    assert.equal(panel.items.find((i) => i.caseId === 'STC-2026-000007').failed, true);
    assert.equal(panel.state, 'Error');
    assert.ok(runs.length >= 4);
    // the failed run is discussed with the deterministic analysis
    const failed = panel.items.find((i) => i.failed);
    const analysis = await session.openResult(failed.uuid, { run: failed.runId });
    assert.equal(analysis.run.id, failed.runId);
});

test('team run: unknown team, no release in test with the team', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session } = newSession(repo);
    await assert.rejects(session.prepareTeamRun({ team: 'PT-UNBEKANNT' }), /gibt es nicht/);
    // the assembly team has no test cases; its scope entry exists, so the run is prepared with nothing to run
    const montage = await session.prepareTeamRun({ team: 'PT-MONTAGE' });
    assert.equal(montage.preview.counts.total, 0);
    await assert.rejects(session.prepareTeamRun({ team: 'PT-REPARATUR', processId: 'MON' }), /Kein Release in Test/);
});

void loadUi5Module;
void path;
