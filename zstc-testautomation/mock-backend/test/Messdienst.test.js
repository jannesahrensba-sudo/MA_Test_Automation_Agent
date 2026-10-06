'use strict';
/**
 * Metering service (Messdienst) scenarios: German fault reports for heat cost allocators and smoke alarms,
 * device type rule R10, metering process profiles and the expected net value from the mock price list.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/TestCaseService');
const { MockTestCaseExtractionService } = require('../extraction/MockTestCaseExtractionService');
const { parseFloor, normalize } = require('../extraction/germanMetering');
const pricing = require('../common/pricing');
const { setup, teardown, pools, createDraft, activate } = require('./helpers');

const TEXT_HKV =
    'Frau Müller aus der Musterstraße 12 in München (1. OG links) meldet über Petra Wagner von der Hausverwaltung, dass der Heizkostenverteiler im Wohnzimmer nichts mehr anzeigt – das Display ist komplett dunkel.';
const TEXT_RWM =
    'Im Kinderzimmer der Wohnung Yilmaz (Musterstraße 12, EG rechts) piept der Rauchmelder alle paar Sekunden, obwohl kein Rauch da ist. Bitte dringend jemanden schicken. Gemeldet von Hausmeister Stefan Brandl.';
const TEXT_AMBIGUOUS = 'Bei Familie Müller in der Musterstraße 12 funktioniert ein Heizkostenverteiler nicht.';

const extract = (repo, text) => {
    const { proposals } = new MockTestCaseExtractionService().extract(text, pools(repo));
    return (field) => proposals.find((p) => p.field === field);
};

test('German helpers: floors, sides and street abbreviations', () => {
    assert.deepEqual(parseFloor(normalize('Wohnung im 1. OG links')), { floor: 1, side: 'links' });
    assert.deepEqual(parseFloor(normalize('im Erdgeschoss rechts')), { floor: 0, side: 'rechts' });
    assert.deepEqual(parseFloor(normalize('zweiten Stock')), { floor: 2, side: undefined });
    assert.equal(normalize('Musterstr. 12'), 'musterstrasse 12');
});

test('heat cost allocator report: address, resident and room resolve one device, everything else is derived', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const proposal = extract(repo, TEXT_HKV);
    const value = (field) => proposal(field)?.value;
    assert.equal(value('ServiceReferenceEquipment'), 'HKV-0815-031');
    assert.equal(proposal('ServiceReferenceEquipment').status, 'SUCCESS');
    assert.equal(value('ServiceRefFunctionalLocation'), 'LG-0815-NE03');
    assert.equal(value('SoldToParty'), 'MD-100010');
    assert.equal(value('ReferenceProduct'), 'MD-HKV-FUNK');
    assert.equal(value('ServiceRequestReporter'), 'MD-CP-1001');
    assert.equal(value('ServiceRequestDescription'), 'HKV Wohnzimmer: Display ohne Anzeige');
    assert.equal(value('RespyMgmtServiceTeam'), 'MD-TEAM-MUC');
    assert.equal(proposal('RespyMgmtServiceTeam').source, 'DERIVED');
    assert.equal(value('ServiceOrganization'), 'SO-MD-SUED');
    assert.equal(value('SalesOrganization'), '2010');
    assert.equal(value('ServiceProduct'), 'MD-SRV-STOER');
    assert.equal(value('ServicePart'), 'MD-ERS-HKV');
    assert.equal(Number(value('ServicePartQuantity')), 1);
    assert.equal(proposal('ServiceDocumentPriority'), undefined);
});

test('smoke alarm report: device-specific service, urgency and symptoms', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const value = (field) => extract(repo, TEXT_RWM)(field)?.value;
    assert.equal(value('ServiceReferenceEquipment'), 'RWM-0815-022');
    assert.equal(value('ServiceRefFunctionalLocation'), 'LG-0815-NE02');
    assert.equal(value('ServiceRequestReporter'), 'MD-CP-1002');
    assert.equal(value('ServiceDocumentPriority'), '3');
    assert.equal(value('ServiceRequestDescription'), 'RWM Kinderzimmer: Warnton, Fehlalarm');
    assert.equal(value('ServiceProduct'), 'MD-SRV-RWM');
    assert.equal(value('ServicePart'), 'MD-ERS-RWM');
});

test('several devices of the same type in the usage unit stay ambiguous; the unit is still derived', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const proposal = extract(repo, TEXT_AMBIGUOUS);
    const equipment = proposal('ServiceReferenceEquipment');
    assert.equal(equipment.status, 'WARNING');
    assert.deepEqual(equipment.candidates, ['HKV-0815-031', 'HKV-0815-032', 'HKV-0815-033']);
    assert.equal(proposal('ServiceRefFunctionalLocation').value, 'LG-0815-NE03');
    assert.equal(proposal('ServiceRefFunctionalLocation').status, 'SUCCESS');
    assert.equal(proposal('ServiceRequestReporter'), undefined);
});

test('the blocked predecessor model is never proposed as spare part', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const part = extract(repo, 'Parkweg 7, 2. OG rechts: HKV zeigt Fehlercode F4, bitte austauschen.')('ServicePart');
    assert.deepEqual(part.candidates, ['MD-ERS-HKV']);
});

test('R10: a heat cost allocator part for a smoke alarm is rejected with the fitting part as suggestion', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo, 'MD_RWM_STOER', TEXT_RWM);
    await service.analyze(repo, draft);
    await repo.update('TestCaseData', draft, { ServicePart: 'MD-ERS-HKV' });
    const { result } = await service.validateTestCase(repo, draft);
    assert.equal(result.overall, 'INVALID');
    const finding = result.items.find((i) => i.FieldName === 'ServicePart');
    assert.equal(finding.RuleID, 'R10_DEVICE_TYPE');
    assert.equal(finding.SuggestedValue, 'MD-ERS-RWM');
    // the domain-wide service product fits every metering device, an H2 service product does not
    await repo.update('TestCaseData', draft, { ServicePart: 'MD-ERS-RWM', ServiceProduct: 'MD-SRV-STOER' });
    assert.equal((await service.validateTestCase(repo, draft)).result.overall, 'VALID');
    await repo.update('TestCaseData', draft, { ServiceProduct: 'P700_SERV_ONS' });
    const h2 = (await service.validateTestCase(repo, draft)).result.items.find((i) => i.FieldName === 'ServiceProduct');
    assert.equal(h2.RuleID, 'R10_DEVICE_TYPE');
});

test('metering golden path: German report → analyze → validate → save → approve → execute → PASSED with 108.00 EUR', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo, 'MD_HKV_STOER', TEXT_HKV);
    const initial = await repo.findOne('TestCaseData', draft);
    // profile defaults: one hour technician visit, one replacement device, metering sales organization
    assert.equal(initial.ServiceProduct, 'MD-SRV-STOER');
    assert.equal(Number(initial.ServiceDuration), 1);
    assert.equal(initial.ServicePart, 'MD-ERS-HKV');
    assert.equal(initial.SalesOrganization, '2010');
    assert.equal(initial.ExpectedNetAmount, null);

    await service.analyze(repo, draft);
    const data = await repo.findOne('TestCaseData', draft);
    // determination: expected net value from the mock price list (1 HR × 69.00 + 1 PC × 39.00)
    assert.equal(Number(data.ExpectedNetAmount), 108);
    assert.equal(pricing.expectedNetAmount(data), 108);
    const { result } = await service.validateTestCase(repo, draft);
    assert.equal(result.overall, 'VALID', JSON.stringify(result.items.filter((i) => i.ValidationStatus !== 'SUCCESS')));

    const active = await activate(repo, draft);
    assert.equal((await repo.findOne('TestCase', active)).CaseID, 'STC-2026-000015');
    await service.approve(repo, active);
    await service.startExecution(repo, active);
    tick(15000);
    const finished = await service.refreshExecution(repo, active);
    assert.equal(finished.testCase.FinalResult, 'PASSED');
    const netValue = (await repo.find('TestAssertion', { TestCaseUUID: active.TestCaseUUID })).find((a) => a.Field === 'NetValue');
    assert.equal(netValue.ActualValue, '108.00 EUR');
});

test('a maintained expected net value is kept; clearing it recalculates it', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo, 'MD_RWM_STOER', TEXT_RWM);
    await service.analyze(repo, draft);
    assert.equal(Number((await repo.findOne('TestCaseData', draft)).ExpectedNetAmount), 94);
    await repo.update('TestCaseData', draft, { ServiceDuration: 2, ExpectedNetAmount: 150 });
    await service.onTestDataChanged(repo, draft, ['ServiceDuration', 'ExpectedNetAmount']);
    assert.equal(Number((await repo.findOne('TestCaseData', draft)).ExpectedNetAmount), 150);
    await repo.update('TestCaseData', draft, { ExpectedNetAmount: null });
    await service.onTestDataChanged(repo, draft, ['ExpectedNetAmount']);
    assert.equal(Number((await repo.findOne('TestCaseData', draft)).ExpectedNetAmount), 153);
});
