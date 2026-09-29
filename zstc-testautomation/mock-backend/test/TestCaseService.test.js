'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/TestCaseService');
const { setup, teardown, GOLDEN, GOLDEN_DOCUMENTS } = require('./helpers');

const GOLDEN_TEXT =
    'Customer C700-C00 reports "System cooling partially failed" on equipment EL-100 at functional location H2POWC00-PROD. ' +
    'Reporter Michael Fischer, service team ICNT_1SUP-DE, priority medium. Plan on-site service P700_SERV_ONS 3 HR and spare part P700-SC-100 1 PC. ' +
    'Expected net value 3.693 EUR.';

let uuidCounter = 0;
const newUuid = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`;

/** Simulates Create (draft) + Activate as the FE mock server does it: draft rows are copied to active rows */
async function createDraft(repo, processProfile = 'FS_TM', text = '') {
    const tc = { TestCaseUUID: newUuid(), IsActiveEntity: false, HasActiveEntity: false, HasDraftEntity: false, NaturalLanguageInput: text };
    Object.assign(tc, service.initialTestCase({ ProcessProfile: processProfile }));
    await repo.add('TestCase', tc);
    await service.createTestData(repo, tc);
    await service.syncDerived(repo, tc.TestCaseUUID);
    return { TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: false };
}

async function activate(repo, draftKeys) {
    for (const set of ['TestCase', 'TestCaseData', 'ValidationResult']) {
        for (const row of await repo.find(set, { TestCaseUUID: draftKeys.TestCaseUUID, IsActiveEntity: false })) {
            const keyName = set === 'ValidationResult' ? 'ValidationUUID' : 'TestCaseUUID';
            await repo.remove(set, { [keyName]: row[keyName], IsActiveEntity: false });
            await repo.add(set, { ...row, IsActiveEntity: true, HasDraftEntity: false, DraftAdministrativeData: null });
        }
    }
    const keys = { TestCaseUUID: draftKeys.TestCaseUUID, IsActiveEntity: true };
    await service.onActivated(repo, keys);
    await service.syncDerived(repo, keys.TestCaseUUID);
    return keys;
}

test('golden path: describe → analyze → validate → save → approve → execute → verify (DoD-2)', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo, 'FS_TM', GOLDEN_TEXT);

    // defaults of the customizing are set on the new draft
    const initial = await repo.findOne('TestCaseData', draft);
    assert.equal(initial.ServiceRequestType, 'SRVR');
    assert.equal(initial.TransactionCurrency, 'EUR');
    assert.equal(initial.__FieldControl.SoldToParty, 7);
    assert.equal(initial.__FieldControl.ServiceProfile, 3);

    const analyzed = await service.analyze(repo, draft);
    assert.equal(analyzed.messages[0].numericSeverity, 1);
    const data = await repo.findOne('TestCaseData', draft);
    for (const [field, value] of Object.entries(GOLDEN)) {
        assert.equal(String(data[field]), String(value), field);
    }
    assert.equal(data.SalesOrganizationOrgUnitID, 'O 50001010');

    const { testCase, result } = await service.validateTestCase(repo, draft);
    assert.equal(result.overall, 'VALID');
    assert.equal(testCase.ValidationStatus, 'VALID');
    assert.ok(testCase.SAP__Messages.every((m) => m.numericSeverity === 1));

    const active = await activate(repo, draft);
    const saved = await repo.findOne('TestCase', active);
    assert.equal(saved.CaseID, 'STC-2026-000004');
    assert.equal(saved.__OperationControl.approve, true);
    assert.equal(saved.__OperationControl.startExecution, false);

    await service.approve(repo, active);
    const started = await service.startExecution(repo, active);
    assert.equal(started.testCase.ExecutionStatus, 'RUNNING');
    assert.equal(started.testCase.ExternalExecutionID, 'MOCK-20260929-0002');
    assert.equal((await repo.find('ExecutionStep', { ExecutionUUID: started.testCase.LatestExecutionUUID })).length, 6);
    assert.equal((await repo.find('DocumentReference', { ExecutionUUID: started.testCase.LatestExecutionUUID })).length, 0);

    tick(5000);
    const running = await service.refreshExecution(repo, active);
    assert.equal(running.testCase.ExecutionStatus, 'RUNNING');
    assert.equal((await repo.find('DocumentReference', { ExecutionUUID: started.testCase.LatestExecutionUUID })).length, 2);

    tick(10000);
    const finished = await service.refreshExecution(repo, active);
    assert.equal(finished.testCase.ExecutionStatus, 'FINISHED');
    assert.equal(finished.testCase.FinalResult, 'PASSED');
    const documents = (await repo.find('DocumentReference', { ExecutionUUID: started.testCase.LatestExecutionUUID })).sort((a, b) => a.Sequence - b.Sequence);
    assert.deepEqual(documents.map((d) => d.DocumentID), GOLDEN_DOCUMENTS);
    const assertions = await repo.find('TestAssertion', { ExecutionUUID: started.testCase.LatestExecutionUUID });
    assert.ok(assertions.length >= 15);
    assert.ok(assertions.every((a) => a.Result === 'PASSED'));
    const derived = service.deriveTestCase(finished.testCase);
    assert.equal(derived.Status, 'COMPLETED');
    assert.equal(derived.__EntityControl.Deletable, false);
});

test('error path: wrong equipment → INVALID, suggestion applied → VALID', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo);
    await repo.update('TestCaseData', draft, { ...GOLDEN, ServiceReferenceEquipment: 'EL-200' });
    const first = await service.validateTestCase(repo, draft);
    assert.equal(first.result.overall, 'INVALID');
    const message = first.testCase.SAP__Messages.find((m) => m.target === '_TestCaseData/ServiceReferenceEquipment');
    assert.equal(message.numericSeverity, 4);
    assert.equal(message.transition, false);

    const finding = (await repo.find('ValidationResult', draft)).find((r) => r.FieldName === 'ServiceReferenceEquipment');
    assert.equal(service.deriveValidationResult(finding).__OperationControl.applySuggestion, true);
    const applied = await service.applySuggestion(repo, { ValidationUUID: finding.ValidationUUID, IsActiveEntity: false }, 'EL-101');
    assert.equal(applied.validationResult.ResolvedValue, 'EL-101');
    assert.equal(service.deriveValidationResult(applied.validationResult).__OperationControl.applySuggestion, false);
    assert.equal((await repo.findOne('TestCaseData', draft)).ServiceReferenceEquipment, 'EL-101');

    const second = await service.validateTestCase(repo, draft);
    assert.equal(second.result.overall, 'VALID');
});

test('changing test data resets the validation and revokes an approval', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo);
    await repo.update('TestCaseData', draft, GOLDEN);
    await service.validateTestCase(repo, draft);
    await repo.update('TestCase', draft, { ApprovalStatus: 'APPROVED' });
    await repo.update('TestCaseData', draft, { ServiceDuration: 4 });
    await service.onTestDataChanged(repo, draft, ['ServiceDuration']);
    const tc = await repo.findOne('TestCase', draft);
    assert.equal(tc.ValidationStatus, 'NOT_VALIDATED');
    assert.equal(tc.ApprovalStatus, 'REVOKED');
});

test('AUTHORIZATION_ERROR: four-eyes profile rejects the approval by the creator', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo, 'FS_TM_4EYES');
    await repo.update('TestCaseData', draft, GOLDEN);
    await service.validateTestCase(repo, draft);
    const active = await activate(repo, draft);
    await assert.rejects(service.approve(repo, active), (error) => error.category.name === 'AUTHORIZATION_ERROR' && error.statusCode === 403);
});

test('TECHNICAL_ERROR: provider outage profile and not connected provider', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo, 'FS_TM_OUTAGE');
    await repo.update('TestCaseData', draft, GOLDEN);
    await service.validateTestCase(repo, draft);
    const active = await activate(repo, draft);
    await service.approve(repo, active);
    await assert.rejects(service.startExecution(repo, active), (error) => error.category.name === 'TECHNICAL_ERROR' && error.number === 501);
    await repo.update('ProcessProfile', { ProcessProfile: 'FS_TM_OUTAGE', IsActiveEntity: true }, { ExecutionProvider: 'CALM_TAT' });
    await assert.rejects(service.startExecution(repo, active), (error) => error.number === 502 && /not connected/.test(error.message));
});

test('BUSINESS_ERROR: approve needs VALID, analyze needs a description', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo);
    await assert.rejects(service.analyze(repo, draft), (error) => error.category.name === 'BUSINESS_ERROR' && error.target === 'NaturalLanguageInput');
    const active = await activate(repo, draft);
    await assert.rejects(service.approve(repo, active), (error) => error.number === 203);
});

test('EXECUTION_ERROR: failed step (SIM-6) and cancel (SIM-7)', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo);
    await repo.update('TestCaseData', draft, { ...GOLDEN, ServicePart: 'P700-SC-999', ExpectedNetAmount: 3999 });
    assert.equal((await service.validateTestCase(repo, draft)).result.overall, 'VALID');
    const active = await activate(repo, draft);
    await service.approve(repo, active);
    await service.startExecution(repo, active);
    tick(20000);
    const failed = await service.refreshExecution(repo, active);
    assert.equal(failed.testCase.FinalResult, 'FAILED_TECHNICAL');
    assert.ok(failed.messages.some((m) => /EXECUTION_ERROR in step 4/.test(m.message)));

    await service.startExecution(repo, active);
    tick(3000);
    const cancelled = await service.cancelExecution(repo, active);
    assert.equal(cancelled.testCase.ExecutionStatus, 'CANCELLED');
    assert.equal(cancelled.testCase.FinalResult, 'BLOCKED');
    await assert.rejects(service.cancelExecution(repo, active), (error) => error.category.name === 'EXECUTION_ERROR');
});

test('field control follows the customizing (7 mandatory, 3 optional, 0 hidden)', () => {
    const control = service.fieldControl([
        { FieldName: 'SoldToParty', Required: true, Active: true },
        { FieldName: 'ServiceProfile', Required: false, Active: true },
        { FieldName: 'ResponseProfile', Required: true, Active: false }
    ]);
    assert.equal(control.SoldToParty, 7);
    assert.equal(control.ServiceProfile, 3);
    assert.equal(control.ResponseProfile, 0);
    assert.equal(control.ServiceDuration, 3);
});
