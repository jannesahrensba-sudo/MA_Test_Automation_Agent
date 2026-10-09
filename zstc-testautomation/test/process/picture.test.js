'use strict';
/**
 * Process picture (webapp/ext/process/pictureLayout.js): the section of a test case follows the same rule as the backend,
 * swim lanes per process team, handovers, documents taken over from a predecessor, results of a run, coverage and the
 * whole process with alternatives in their own rows.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadUi5Module } = require('../../tools/common/loadUi5Module');
const catalog = require('../../mock-backend/process/processCatalog');
const backendHelpers = require('../../mock-backend/test/helpers');

const picture = loadUi5Module(path.join(__dirname, '../../webapp/ext/process/pictureLayout.js'));

function steps() {
    const data = backendHelpers.loadAllData();
    const teams = Object.fromEntries(data.ProcessTeamVH.map((t) => [t.ProcessTeam, t.ProcessTeamName]));
    return data.ProcessStepVH.filter((s) => s.ProcessID === 'SRV-REP').map((s) => ({ ...s, TeamName: teams[s.ResponsibleTeam] }));
}

test('the section of the picture is the section of the backend for every way, start and end', () => {
    const all = steps();
    const objects = ['', ...catalog.DOCUMENT_ORDER];
    const variants = [...new Set(all.flatMap((s) => String(s.Variants).split(',')))];
    let compared = 0;
    for (const variant of variants) {
        const way = picture.wayPath(all, variant);
        assert.deepEqual(
            way.map((s) => s.StepID),
            catalog.variantPath(all, variant).map((s) => s.StepID)
        );
        for (const start of objects) {
            for (const end of objects) {
                const ui = picture.sectionOf(way, start, end).map((s) => s.StepID);
                const backend = catalog.section(catalog.variantPath(all, variant), start, end).path.map((s) => s.StepID);
                assert.deepEqual(ui, backend, `${variant} ${start}..${end}`);
                compared++;
            }
        }
    }
    assert.ok(compared > 400);
});

test('way of a test case: lanes per team, run section with start and end, handovers, results of the run', () => {
    const model = picture.layout({
        steps: steps(),
        variant: 'W1_REQUEST',
        startObject: 'SERVICE_REQUEST',
        endObject: 'ACCOUNTING_DOCUMENT',
        results: { 'REP-010': 'DONE', 'REP-060': 'DONE', 'REP-080': 'DONE', 'REP-090': 'DONE', 'REP-100': 'FAILED', 'REP-110': 'SKIPPED' }
    });
    assert.equal(model.mode, 'WAY');
    assert.deepEqual(model.nodes.map((n) => n.id), ['REP-010', 'REP-020', 'REP-060', 'REP-070', 'REP-080', 'REP-090', 'REP-100', 'REP-110']);
    assert.deepEqual(model.lanes.map((l) => l.key), ['PT-REPARATUR', 'PT-E2E']);
    assert.ok(model.nodes.every((n) => n.state === 'run'));
    assert.equal(model.nodes[0].flag, 'Start');
    assert.equal(model.nodes[7].flag, 'Ende');
    // the decision and the manual step count as passed once a later step was reached; the failing billing stops the run
    assert.deepEqual(model.nodes.map((n) => n.result), ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'failed', 'notReached']);
    // a step that created its document with a wrong value fails through its test assertion
    const checked = picture.layout({
        steps: steps(),
        variant: 'W1_REQUEST',
        startObject: 'SERVICE_REQUEST',
        endObject: 'ACCOUNTING_DOCUMENT',
        results: { 'REP-010': 'DONE', 'REP-060': 'DONE', 'REP-080': 'DONE', 'REP-090': 'DONE', 'REP-100': 'DONE', 'REP-110': 'DONE' },
        checks: { 'REP-100': 'FAILED', 'REP-010': 'PASSED' }
    });
    assert.equal(checked.nodes.find((n) => n.id === 'REP-100').result, 'failed');
    assert.equal(checked.nodes.find((n) => n.id === 'REP-110').result, 'passed');
    assert.equal(model.nodes.find((n) => n.id === 'REP-020').kind, 'decision');
    assert.equal(model.nodes.find((n) => n.id === 'REP-070').kind, 'manual');
    const handovers = model.edges.filter((e) => e.handover);
    assert.deepEqual(handovers.map((e) => `${e.from}>${e.to}`), ['REP-080>REP-090']);
    assert.equal(model.summary.handovers, 1);
    const svg = picture.svg(model, { id: 'pp1' });
    assert.match(svg, /^<svg class="zstcPp"/);
    assert.match(svg, /aria-label="Prozessbild: 8 von 8 Schritten im Lauf\. Prozessteam Reparatur, Prozessteam New End to End Prozess"/);
    assert.match(svg, /data-step="REP-100"[^>]*aria-label="REP-100, Faktura \(SD\) erzeugen, Prozessteam New End to End Prozess, BD, im Lauf, fehlgeschlagen"/);
});

test('sub-process of a team with a predecessor: the steps before the start are taken over, nothing else runs', () => {
    const model = picture.layout({ steps: steps(), variant: 'W1_REQUEST', startObject: 'BILLING_DOC_REQUEST', endObject: 'ACCOUNTING_DOCUMENT', predecessorObject: 'SERVICE_CONFIRMATION' });
    const states = Object.fromEntries(model.nodes.map((n) => [n.id, n.state]));
    assert.deepEqual(states, {
        'REP-010': 'taken',
        'REP-020': 'taken',
        'REP-060': 'taken',
        'REP-070': 'taken',
        'REP-080': 'taken',
        'REP-090': 'run',
        'REP-100': 'run',
        'REP-110': 'run'
    });
    assert.equal(model.nodes[0].flag, 'vom Vorgänger', 'one label for the taken-over part');
    assert.equal(model.nodes[1].flag, '');
    assert.ok(model.legend.some((l) => l.cls === 'taken'));
    // the quotation team: only its own two steps run; contract determination before a start stays in the section (way 3)
    const quote = picture.layout({ steps: steps(), variant: 'W2_QUOTATION', startObject: 'SERVICE_QUOTATION', endObject: 'SERVICE_QUOTATION' });
    assert.deepEqual(quote.nodes.filter((n) => n.state === 'run').map((n) => n.id), ['REP-030', 'REP-040']);
    assert.equal(quote.nodes.find((n) => n.id === 'REP-060').state, 'after');
    const contract = picture.layout({ steps: steps(), variant: 'W3_CONTRACT', startObject: 'SERVICE_ORDER', endObject: 'BILLING_DOCUMENT' });
    assert.deepEqual(contract.nodes.filter((n) => n.state === 'run').map((n) => n.id), ['REP-050', 'REP-060', 'REP-070', 'REP-080', 'REP-090', 'REP-100']);
});

test('whole process: alternatives in their own rows, connections of all pilot ways, way highlight and coverage', () => {
    const model = picture.layout({ steps: steps(), mode: 'PROCESS' });
    assert.equal(model.mode, 'PROCESS');
    assert.equal(model.nodes.length, 13, 'pilot steps only');
    const node = (id) => model.nodes.find((n) => n.id === id);
    // accept and reject are alternatives after the quotation: same column, own rows in the quotation lane
    assert.equal(node('REP-040').column, node('REP-041').column);
    assert.notEqual(node('REP-040').row, node('REP-041').row);
    // the contract determination sits right before the service order (shortened connection), the billing plan before the billing
    assert.equal(node('REP-050').column, node('REP-060').column - 1);
    assert.equal(node('REP-095').column, node('REP-100').column - 1);
    assert.ok(model.edges.some((e) => e.from === 'REP-020' && e.to === 'REP-060'), 'way 1 skips the quotation');
    assert.ok(model.edges.every((e) => model.nodes.find((n) => n.id === e.to).column > model.nodes.find((n) => n.id === e.from).column), 'left to right');

    const later = picture.layout({ steps: steps(), mode: 'PROCESS', showLater: true });
    assert.equal(later.nodes.length, 17);
    assert.equal(later.nodes.find((n) => n.id === 'REP-210').kind, 'later');

    const way = picture.layout({ steps: steps(), mode: 'PROCESS', variant: 'W3_BILLING_PLAN', section: false });
    assert.deepEqual(way.nodes.filter((n) => n.state === 'way').map((n) => n.id), ['REP-050', 'REP-095', 'REP-100', 'REP-110']);

    const coverage = picture.layout({ steps: steps(), mode: 'PROCESS', coverage: { 'REP-010': 1, 'REP-060': 1, 'REP-080': 1, 'REP-090': 1, 'REP-100': 1, 'REP-110': 1 } });
    assert.deepEqual(coverage.nodes.filter((n) => n.state === 'gap').map((n) => n.id), ['REP-030', 'REP-040', 'REP-041', 'REP-050', 'REP-095']);
    assert.equal(coverage.summary.covered, 6);
    assert.equal(coverage.summary.automated, 11);
});

test('texts are escaped, no way gives an explanation instead of a picture', () => {
    const model = picture.layout({
        steps: [{ StepID: 'X-1', StepName: '<script>alert(1)</script> & "Test"', Sequence: 1, Variants: 'V', PilotScope: 'PILOT', Automation: 'AUTOMATED', ResponsibleTeam: 'T', TeamName: 'Team <b>' }],
        variant: 'V'
    });
    const svg = picture.svg(model);
    assert.ok(!svg.includes('<script>'));
    assert.ok(!svg.includes('<b>'));
    assert.match(svg, /&lt;script&gt;/);
    const empty = picture.layout({ steps: steps(), variant: 'UNKNOWN' });
    assert.equal(empty.empty, picture.TEXTS.empty);
    assert.match(picture.svg(empty), /Kein Weg gewählt/);
    assert.deepEqual(picture.wrap('Kundenanliegen als Service Request erfassen', 18, 2), ['Kundenanliegen als', 'Service Request…']);
});
