'use strict';
/**
 * Agent core (webapp/ext/agent/core) against the mock backend services: master data search, rule-based agent,
 * tools and the Messages API loop with a scripted model.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { core, createMemoryGateway, setup, teardown } = require('./helpers');

const AgentSession = core('AgentSession');
const messagesLoop = core('messagesLoop');
const agentTools = core('agentTools');

const TEXT_HKV =
    'Frau Müller aus der Musterstraße 12 in München (1. OG links) meldet über Petra Wagner von der Hausverwaltung, dass der Heizkostenverteiler im Wohnzimmer nichts mehr anzeigt – das Display ist komplett dunkel.';
const TEXT_AMBIGUOUS = 'Bei Familie Müller in der Musterstraße 12 funktioniert ein Heizkostenverteiler nicht.';

function newSession(repo, transport = { kind: 'rules' }) {
    const gateway = createMemoryGateway(repo);
    const steps = [];
    const session = new AgentSession({ gateway, transport, onStep: (s) => steps.push(s) });
    return { session, gateway, steps };
}

test('master data search finds the device through address, resident, floor and room', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const md = await createMemoryGateway(repo).masterData();
    const device = md.search('geraet', 'Musterstraße 12 Müller 1. OG links Wohnzimmer Heizkostenverteiler');
    assert.equal(device.treffer[0].id, 'HKV-0815-031');
    assert.equal(device.eindeutig, true);
    assert.match(device.treffer[0].liegenschaft, /Musterstraße 12/);
    const contact = md.search('ansprechpartner', 'Petra Wagner');
    assert.equal(contact.treffer[0].id, 'MD-CP-1001');
    const team = md.search('serviceteam', 'Monteurteam München');
    assert.equal(team.treffer[0].id, 'MD-TEAM-MUC');
    assert.equal(md.describe('ServiceRefFunctionalLocation', 'LG-0815-NE03'), 'LG-0815-NE03 · Musterstraße 12, 80331 München, NE 03 · 1. OG links · Nutzer Müller');
    assert.throws(() => md.search('auto', 'x'), /Unbekannter Suchtyp/);
});

test('rule-based agent: German heat cost allocator report → valid draft → saved, approved, started', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session, gateway, steps } = newSession(repo);
    const answer = await session.send(TEXT_HKV);
    assert.equal(answer.mode, 'rules');
    assert.match(answer.text, /Gültig/);
    assert.match(answer.text, /HKV-0815-031/);
    assert.match(answer.text, /108,00 EUR/);
    assert.equal(session.draft.validation.status, 'VALID');
    assert.equal(session.draft.processProfile, 'MD_HKV_STOER');
    assert.ok(steps.some((s) => /Prozess erkannt: MD_HKV_STOER/.test(s.text)));
    const submitted = await session.submit();
    assert.equal(submitted.caseId, 'STC-2026-000007');
    assert.match(submitted.externalExecutionId, /^MOCK-\d{8}-0003$/);
    assert.deepEqual(gateway.calls.map((c) => c[0]).slice(-3), ['save', 'approve', 'start']);
    assert.match((await session.send('Noch etwas?')).text, /bereits übernommen/);
});

test('rule-based agent: ambiguous device and missing reporter lead to questions; the answer resolves both', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session } = newSession(repo);
    const first = await session.send(TEXT_AMBIGUOUS);
    assert.notEqual(session.draft.validation.status, 'VALID');
    assert.match(first.text, /Welches \*\*Gerät\*\* ist gemeint\?/);
    assert.match(first.text, /\*\*Meldender\*\* fehlt/);
    const second = await session.send('Im Schlafzimmer, gemeldet hat es Petra Wagner.');
    assert.equal(session.draft.validation.status, 'VALID', second.text);
    assert.equal(session.draft.values.ServiceReferenceEquipment, 'HKV-0815-032');
    assert.equal(session.draft.values.ServiceRequestReporter, 'MD-CP-1001');
});

test('rule-based agent: R10 finding (profile default part for a water meter) is corrected automatically', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session } = newSession(repo);
    const answer = await session.send('Musterstraße 12, 1. OG links (Müller): der Warmwasserzähler im Bad ist defekt. Gemeldet von Petra Wagner.');
    assert.equal(session.draft.values.ServicePart, 'MD-ERS-WZ');
    assert.equal(session.draft.validation.status, 'VALID', answer.text);
    assert.match(answer.text, /Korrigiert: Ersatzteil MD-ERS-HKV/);
});

test('rule-based agent: a text without location or device creates no draft', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { session, gateway } = newSession(repo);
    const answer = await session.send('Hallo, können Sie mir helfen?');
    assert.match(answer.text, /weder Liegenschaft noch Gerät/);
    assert.equal(session.draft, undefined);
    assert.ok(gateway.calls.some((c) => c[0] === 'discard'));
});

test('tool field normalization: unknown fields ignored, numbers parsed, description shortened', () => {
    const { fields, ignored, notes } = agentTools.normalizeFields({
        ServiceDuration: '1,5',
        ServiceRequestDescription: 'Heizkostenverteiler im Wohnzimmer zeigt überhaupt nichts mehr an',
        Foo: 'bar',
        ServicePart: ''
    });
    assert.equal(fields.ServiceDuration, 1.5);
    assert.equal(fields.ServiceRequestDescription.length, 40);
    assert.equal(fields.ServicePart, null);
    assert.deepEqual(ignored, ['Foo']);
    assert.equal(notes.length, 1);
});

/** scripted model: search → capture → answer (what Claude does with the tools) */
function scriptedModel() {
    const requests = [];
    const responses = [
        {
            stop_reason: 'tool_use',
            content: [
                { type: 'thinking', thinking: '', signature: 'sig-1' },
                { type: 'text', text: 'Ich suche Gerät und Meldenden.' },
                {
                    type: 'tool_use',
                    id: 'toolu_1',
                    name: 'stammdaten_suchen',
                    input: {
                        suchen: [
                            { typ: 'geraet', text: 'Musterstraße 12 Müller 1. OG links Wohnzimmer Heizkostenverteiler' },
                            { typ: 'ansprechpartner', text: 'Petra Wagner' }
                        ]
                    }
                }
            ]
        },
        {
            stop_reason: 'tool_use',
            content: [
                {
                    type: 'tool_use',
                    id: 'toolu_2',
                    name: 'testfall_entwurf_erfassen',
                    input: {
                        prozessprofil: 'MD_HKV_STOER',
                        titel: 'HKV Wohnzimmer ohne Anzeige',
                        felder: {
                            ServiceReferenceEquipment: 'HKV-0815-031',
                            ServiceRefFunctionalLocation: 'LG-0815-NE03',
                            ServiceRequestReporter: 'MD-CP-1001',
                            ServiceRequestDescription: 'HKV Wohnzimmer: Display ohne Anzeige',
                            RespyMgmtServiceTeam: 'MD-TEAM-MUC',
                            SoldToParty: 'MD-100010'
                        }
                    }
                }
            ]
        },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Entwurf erfasst: **Gültig**. Bitte prüfen und mit „Übernehmen & starten“ bestätigen.' }] }
    ];
    return {
        requests,
        send: async (request) => {
            requests.push(JSON.parse(JSON.stringify(request)));
            return responses.shift();
        }
    };
}

test('Messages API loop: tools run in the page, the history is append-only with tool results', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const model = scriptedModel();
    const { session } = newSession(repo, { kind: 'proxy', send: model.send });
    const answer = await session.send(TEXT_HKV);
    assert.equal(answer.mode, 'proxy');
    assert.match(answer.text, /Gültig/);
    assert.equal(session.draft.validation.status, 'VALID');
    assert.equal(Number(session.draft.values.ExpectedNetAmount), 108);
    assert.equal(session.draft.values.ServiceProduct, 'MD-SRV-STOER');
    // request 3 carries: user, assistant(thinking+text+tool_use), user(tool_result), assistant(tool_use), user(tool_result)
    const last = model.requests[2];
    assert.equal(last.messages.length, 5);
    assert.deepEqual(last.messages[1].content[0], { type: 'thinking', thinking: '', signature: 'sig-1' });
    assert.equal(last.messages[2].content[0].type, 'tool_result');
    assert.equal(last.messages[2].content[0].tool_use_id, 'toolu_1');
    const capture = JSON.parse(last.messages[4].content[0].content);
    assert.equal(capture.validierung, 'VALID');
    assert.match(capture.werte.ExpectedNetAmount, /108,00 EUR/);
    assert.match(last.system, /Messdienst/);
    assert.deepEqual(last.tools.map((tool) => tool.name), ['stammdaten_suchen', 'testfall_entwurf_erfassen']);
    assert.match(last.messages[0].content, /^\[Kontext der App\]/);
    assert.equal(session.apiMessages.length, 6);
});

test('Messages API loop: a failing tool is reported as is_error, a refusal leaves the history untouched', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const tools = [
        {
            name: 'boom',
            description: 'fails',
            inputSchema: { type: 'object' },
            execute: async () => {
                throw new Error('kaputt');
            }
        }
    ];
    const history = [];
    const responses = [
        { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_x', name: 'boom', input: {} }] },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }
    ];
    const result = await messagesLoop.run({ send: async () => responses.shift(), system: 's', history, userContent: 'u', tools });
    assert.equal(result.text, 'ok');
    assert.equal(history[2].content[0].is_error, true);
    assert.match(history[2].content[0].content, /kaputt/);
    const before = history.length;
    const refused = await messagesLoop.run({ send: async () => ({ stop_reason: 'refusal', content: [] }), system: 's', history, userContent: 'x', tools });
    assert.equal(refused.stopReason, 'refusal');
    assert.equal(history.length, before);
});

test('sample transport: the platform calls the page tools; the chat keeps text turns only', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    let seenTurns;
    const sample = async (turns, options) => {
        seenTurns = turns;
        const byName = Object.fromEntries(options.tools.map((tool) => [tool.name, tool]));
        await byName.stammdaten_suchen.execute({ suchen: [{ typ: 'geraet', text: 'Musterstraße 12 Müller Wohnzimmer Heizkostenverteiler' }] }, { signal: undefined });
        const capture = await byName.testfall_entwurf_erfassen.execute(
            {
                prozessprofil: 'MD_HKV_STOER',
                felder: { ServiceReferenceEquipment: 'HKV-0815-031', ServiceRequestReporter: 'MD-CP-1001', ServiceRequestDescription: 'HKV Wohnzimmer: Display ohne Anzeige', RespyMgmtServiceTeam: 'MD-TEAM-MUC' }
            },
            { signal: undefined }
        );
        options.onText({ text: 'Fertig.', delta: 'Fertig.' });
        return { text: `Fertig: ${capture.validierung}`, truncated: false, modelTierApplied: 'default' };
    };
    const { session } = newSession(repo, { kind: 'sample', sample });
    const answer = await session.send(TEXT_HKV);
    assert.equal(answer.text, 'Fertig: VALID');
    assert.equal(seenTurns[0].role, 'user');
    assert.match(seenTurns[0].content, /Service-Assistent/);
    assert.equal(session.chat.length, 2);
    // determinations: functional location, customer and service organization follow equipment and team
    assert.equal(session.draft.values.ServiceRefFunctionalLocation, 'LG-0815-NE03');
    assert.equal(session.draft.values.SoldToParty, 'MD-100010');
    assert.equal(session.draft.values.ServiceOrganization, 'SO-MD-SUED');
});
