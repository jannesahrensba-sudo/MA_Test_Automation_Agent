'use strict';
/**
 * "Ergebnis besprechen": discussion of a run result in the service assistant — German report and follow-up answers of
 * the mock agent from the deterministic result analysis, the tool ergebnis_lesen of the language model and the
 * jump-off from a Case ID in the chat. Seed data: STC-2026-000007 (second run fails: expectation not updated after a
 * changed duration), STC-2026-000014 (continues with the documents of STC-2026-000013), STC-2026-000006 (never run).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, createMemoryGateway, setup, teardown } = require('./helpers');

const AgentSession = core('AgentSession');
const resultReport = core('resultReport');

function newSession(repo, transport = { kind: 'rules' }) {
    const gateway = createMemoryGateway(repo);
    const steps = [];
    const shown = [];
    const session = new AgentSession({ gateway, transport, onStep: (s) => steps.push(s), onAnalysis: (a) => shown.push(a) });
    return { session, gateway, steps, shown };
}

test('result of a failed run: verdict, cause with evidence and confidence, team, regression (German)', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session, gateway, steps, shown } = newSession(repo);
    const analysis = await session.openResultByCaseId('STC-2026-000007');
    assert.equal(shown.length, 1);
    assert.equal(analysis.run.id, 'MOCK-20261001-0007');
    assert.equal(analysis.run.result, 'FAILED_FUNCTIONAL');
    assert.deepEqual(
        analysis.findings.map((f) => f.code),
        ['NET_VALUE_DEVIATION', 'REGRESSION']
    );
    assert.ok(steps.some((s) => /Ergebnis gelesen: STC-2026-000007 · Lauf MOCK-20261001-0007 · Fachlich fehlgeschlagen · 2 Befunde/.test(s.text)));

    const { describe } = await gateway.masterData();
    const report = resultReport.report(analysis, describe);
    assert.match(report, /\*\*Fachlich fehlgeschlagen\*\*/);
    assert.match(report, /19 von 20 Prüfungen bestanden, 1 abweichend/);
    assert.match(report, /Nettowert 183,00 EUR statt 114,00 EUR \(Differenz 69,00 EUR, Toleranz 0,00 EUR\)/);
    assert.match(report, /weicht um 1 Std\. MD-SRV-STOER \(69,00 EUR je Stunde\) ab/);
    assert.match(report, /\[Konfidenz hoch\]/);
    assert.match(report, /zuständig PT-REPARATUR · Prozessteam Reparatur/);
    assert.match(report, /Testfall-Version 2: geändert Einsatzdauer/);
    assert.match(report, /Empfehlung: Stimmen die Testdaten, den erwarteten Nettowert auf 183,00 EUR setzen/);

    // panel of the page
    const panel = resultReport.panel(analysis, describe);
    assert.equal(panel.resultState, 'Error');
    assert.equal(panel.findings[0].state, 'Error');
    assert.equal(panel.findings[0].info, 'Konfidenz hoch');
    assert.match(panel.headline, /Die Belege sind genau so bepreist, wie es die Testdaten vorgeben \(183,00 EUR\)/);
});

test('mock agent answers follow-up questions from the analysis only', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session, steps } = newSession(repo);
    await session.openResultByCaseId('STC-2026-000007');

    const team = await session.send('Wer ist zuständig?');
    assert.equal(steps.at(-1).text, 'Antwort aus der Ergebnisanalyse: Zuständigkeit');
    assert.match(team.text, /Zuständig laut Analyse/);
    assert.match(team.text, /\*\*PT-REPARATUR · Prozessteam Reparatur\*\*/);
    assert.match(team.text, /kein Team festgelegt \(Vergleich bzw\. Gesamtergebnis\)/);

    const changed = await session.send('Was hat sich seit dem letzten Lauf geändert?');
    assert.match(changed.text, /Seit dem erfolgreichen Lauf geändert: Testfall-Version 2: geändert Einsatzdauer/);
    assert.match(changed.text, /MOCK-20261001-0007 · .* · Release INT-2026\.10 · Version 2: Fachlich fehlgeschlagen/);
    assert.match(changed.text, /MOCK-20260928-0003 · .* · Version 1: Bestanden/);

    const sure = await session.send('Wie sicher ist das?');
    assert.match(sure.text, /Konfidenz hoch – durch die Evidenz belegt\. Evidenz: Assertion NetValue of Billing Document/);
    assert.match(sure.text, /Konfidenz mittel – passt zu einer bekannten Ursache/);

    const todo = await session.send('Was soll ich tun?');
    assert.match(todo.text, /Empfohlene nächste Schritte:/);
    assert.match(todo.text, /1\. Stimmen die Testdaten, den erwarteten Nettowert auf 183,00 EUR setzen/);
    assert.match(todo.text, /neue Version, die neu validiert und freigegeben werden muss/);
    assert.doesNotMatch(todo.text, /Schritte des Laufs/, 'the next step is a recommendation, not the step log');

    const net = await session.send('Warum ist der Nettowert so hoch?');
    assert.match(net.text, /Ursachen laut Analyse/);
    assert.match(net.text, /Prüfung Faktura: Soll 114,00 EUR, Ist 183,00 EUR, Toleranz 0,00 EUR → abweichend/);
    assert.match(net.text, /Testdaten: MD-SRV-STOER 2 Std\./);

    const documents = await session.send('Welche Belege wurden erzeugt?');
    assert.match(documents.text, /Faktura \*\*90000\d+\*\* – erzeugt/);

    const unknown = await session.send('Wie wird das Wetter morgen?');
    assert.match(unknown.text, /nichts Sicheres sagen/);
    // the discussion does not touch the draft
    assert.equal(session.draft, undefined);
    assert.equal(session.originalText, '');
});

test('handover run and a test case without run', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session, gateway } = newSession(repo);
    const { describe } = await gateway.masterData();
    const handover = await session.openResultByCaseId('STC-2026-000014');
    const report = resultReport.report(handover, describe);
    assert.match(report, /\*\*Bestanden\*\*/);
    assert.match(report, /6 Belege \(3 übernommen\)/);
    assert.match(report, /Der Lauf setzt auf Service Request 8000000005, Serviceauftrag 8000000024, Rückmeldung 8999999996 aus STC-2026-000013 · MOCK-20260929-0005 auf/);
    const answer = await session.send('Was wurde übergeben?');
    assert.match(answer.text, /Scheitert der erste eigene Schritt, zuerst den übergebenen Beleg im Lauf des Vorgänger-Testfalls prüfen/);

    const never = await session.openResultByCaseId('STC-2026-000006');
    assert.equal(never.run, null);
    assert.match(resultReport.report(never, describe), /noch nicht ausgeführt/);
    await assert.rejects(session.openResultByCaseId('STC-2099-000001'), /nicht gefunden/);
});

test('jump-off from the chat: a Case ID with a result question opens the discussion; closing returns to the draft', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session, shown } = newSession(repo);
    const answer = await session.send('Bitte das Ergebnis von STC-2026-000007 besprechen');
    assert.equal(session.analysis.caseId, 'STC-2026-000007');
    assert.match(answer.text, /Ergebnis von \*\*STC-2026-000007\*\*/);
    const other = await session.send('Und warum ist STC-2026-000014 bestanden?');
    assert.equal(session.analysis.caseId, 'STC-2026-000014');
    assert.match(other.text, /Bestanden/);
    session.closeAnalysis();
    assert.equal(session.analysis, undefined);
    assert.equal(shown.at(-1), undefined);
});

test('language model: ergebnis_lesen reads the result, the analysis has its own instructions and context', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const requests = [];
    const responses = [
        { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_r1', name: 'ergebnis_lesen', input: { case_id: 'STC-2026-000013' } }] },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Der Vorgänger STC-2026-000013 ist bestanden; die Abweichung liegt in der Erwartung.' }] }
    ];
    const send = async (request) => {
        requests.push(JSON.parse(JSON.stringify(request)));
        return responses.shift();
    };
    const { session } = newSession(repo, { kind: 'proxy', send });
    await session.openResultByCaseId('STC-2026-000007');
    const answer = await session.send('Kann der Fehler vom Vorgänger kommen?');
    assert.match(answer.text, /Erwartung/);
    const first = requests[0];
    assert.deepEqual(first.tools.map((tool) => tool.name), ['ergebnis_lesen']);
    assert.match(first.system, /Ergebnis eines Testlaufs/);
    assert.match(first.system, /Nenne als Ursache nur, was ein Befund oder die Daten des Laufs belegen/);
    assert.match(first.messages[0].content, /^\[Kontext der App\]\nBesprochen wird das Ergebnis von STC-2026-000007/);
    assert.match(first.messages[0].content, /Befund 1 \(Fehler, NET_VALUE_DEVIATION, Konfidenz hoch, Schritt REP-100 Faktura \(SD\) erzeugen, Team PT-REPARATUR\)/);
    const toolResult = JSON.parse(requests[1].messages[2].content[0].content);
    assert.equal(toolResult.testfall, 'STC-2026-000013');
    assert.equal(toolResult.lauf.ergebnis, 'Bestanden');
    assert.equal(toolResult.befunde[0].code, 'ALL_PASSED');
    // reading another test case keeps the discussed one
    assert.equal(session.analysis.caseId, 'STC-2026-000007');
});

test('German change texts of the version history', () => {
    assert.equal(resultReport.changeText('test case version 3: Changed: ServiceDuration, ExpectedNetAmount, Test steps'), 'Testfall-Version 3: geändert Einsatzdauer, Erwarteter Nettowert, Testschritte');
    assert.equal(resultReport.changeText('process version 1 → 2'), 'Prozessversion 1 → 2');
    assert.equal(resultReport.changeText('test case version 1: Initial version'), 'Testfall-Version 1: erste Version');
});

test('jump-off with a given run (analytics of a release): that run is discussed, with a hint to the newest run', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session, gateway } = newSession(repo);
    const { describe } = await gateway.masterData();
    const uuid = await gateway.findTestCase('STC-2026-000007');
    const older = await session.openResult(uuid, { run: 'MOCK-20260928-0003' });
    assert.equal(older.run.id, 'MOCK-20260928-0003');
    assert.equal(older.run.result, 'PASSED');
    assert.deepEqual(older.findings.map((f) => f.code), ['ALL_PASSED']);
    const report = resultReport.report(older, describe);
    assert.match(report, /\*\*Bestanden\*\*/);
    assert.match(report, /Hinweis: Das ist nicht der neueste Lauf des Testfalls; neuester Lauf ist \*\*MOCK-20261001-0007\*\*/);
    // unknown run: the latest run is discussed
    const latest = await session.openResult(uuid, { run: 'MOCK-19990101-9999' });
    assert.equal(latest.run.id, 'MOCK-20261001-0007');
    assert.doesNotMatch(resultReport.report(latest, describe), /nicht der neueste Lauf/);
});
