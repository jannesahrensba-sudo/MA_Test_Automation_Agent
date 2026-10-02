'use strict';
/**
 * Process teams, process variants, versions, roles and releases: the traceability chain
 * process team → business process → process step → test case → test run → result.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/TestCaseService');
const processService = require('../services/ProcessService');
const releaseService = require('../services/ReleaseService');
const catalog = require('../process/processCatalog');
const { MockExecutionProvider } = require('../execution/MockExecutionProvider');
const { verify } = require('../verification/VerificationService');
const { setup, teardown, GOLDEN, createDraft, activate } = require('./helpers');

const ACTIVE = (uuid) => ({ TestCaseUUID: uuid, IsActiveEntity: true });
const SEED = {
    W1_FI: '6f1c2a10-0007-4c3e-9a51-000000000007',
    W3: '6f1c2a10-0010-4c3e-9a51-000000000010',
    W3_BILLING_PLAN: '6f1c2a10-0011-4c3e-9a51-000000000011',
    ANGEBOT: '6f1c2a10-0012-4c3e-9a51-000000000012',
    VERSION_2: '6f1c2a10-0004-4c3e-9a51-000000000004'
};

async function model(repo) {
    return processService.processModel(repo, 'SRV-REP');
}

test('process catalog: plans per way, end object and document chain', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const { steps } = await model(repo);
    const plan = (variant, endObject) => catalog.executionPlan(steps, variant, endObject).map((s) => s.processStepID);
    assert.deepEqual(plan('W1_REQUEST', 'BILLING_DOCUMENT'), ['REP-010', 'REP-060', 'REP-080', 'REP-090', 'REP-100']);
    assert.deepEqual(plan('W2_QUOTATION', 'BILLING_DOCUMENT'), ['REP-010', 'REP-030', 'REP-040', 'REP-060', 'REP-080', 'REP-090', 'REP-100']);
    assert.deepEqual(plan('W2_REJECTED'), ['REP-010', 'REP-030', 'REP-041']);
    assert.deepEqual(plan('W3_CONTRACT', 'SERVICE_ORDER'), ['REP-050', 'REP-060'], 'run up to the service order');
    assert.deepEqual(plan('W3_BILLING_PLAN', 'ACCOUNTING_DOCUMENT'), ['REP-050', 'REP-095', 'REP-100', 'REP-110']);
    assert.ok(!plan('REQUOTE').includes('REP-210'), 'steps of later extensions are never part of a plan');
    assert.equal(catalog.documentPath(catalog.variantPath(steps, 'W1_REQUEST')), 'SR → SO → SC → BDR → BD → FI');
    // design path with decision and manual step, handover to the quotation team
    const design = catalog.designSteps(steps, 'W2_QUOTATION', 'SERVICE_ORDER');
    assert.deepEqual(design.map((s) => s.ProcessStepID), ['REP-010', 'REP-020', 'REP-030', 'REP-040', 'REP-060']);
    assert.deepEqual(design.filter((s) => s.IsHandover).map((s) => s.ProcessStepID), ['REP-030', 'REP-060']);
    assert.equal(design.find((s) => s.ProcessStepID === 'REP-020').Automation, 'DECISION');
});

test('new test case: process reference from the team of the user, steps of the default variant', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo);
    const tc = await repo.findOne('TestCase', draft);
    assert.equal(tc.ProcessTeam, 'PT-REPARATUR');
    assert.equal(tc.BusinessProcess, 'SRV-REP');
    assert.equal(tc.ProcessVariant, 'W2_QUOTATION');
    assert.equal(tc.EndObject, 'BILLING_DOCUMENT');
    assert.equal(tc.TestLevel, 'E2E', 'the quotation step hands over to another team');
    assert.equal(tc.BusinessOwner, 'DEMO_USER');
    assert.equal(tc.AssignmentStatus, 'ASSIGNED');
    assert.equal(tc.ProcessVersion, 2);
    const steps = (await repo.find('TestCaseStep', draft)).sort((a, b) => a.StepNo - b.StepNo);
    assert.equal(steps.length, 9);
    assert.ok(steps.every((s) => s.StepSource === 'DERIVED' && s.Action && s.ExpectedResult));

    // way 1 up to the service order: other steps, sub-process of the team, a manual step is kept
    await repo.add('TestCaseStep', { TestCaseStepUUID: 'manual-1', TestCaseUUID: draft.TestCaseUUID, IsActiveEntity: false, StepNo: 999, Action: 'Termin bestätigen', StepSource: 'USER' });
    await repo.update('TestCase', draft, { ProcessVariant: 'W1_REQUEST', EndObject: 'SERVICE_ORDER' });
    await service.onProcessReferenceChanged(repo, draft, ['ProcessVariant', 'EndObject']);
    const changed = await repo.findOne('TestCase', draft);
    assert.equal(changed.TestLevel, 'SUB_PROCESS');
    const newSteps = (await repo.find('TestCaseStep', draft)).sort((a, b) => a.StepNo - b.StepNo);
    assert.deepEqual(newSteps.map((s) => s.ProcessStepID || s.Action), ['REP-010', 'REP-020', 'REP-060', 'Termin bestätigen']);
    assert.equal(newSteps[3].StepNo, 40);

    // an end object outside the path falls back to the default end object of the variant
    await repo.update('TestCase', draft, { ProcessVariant: 'W2_REJECTED' });
    await service.onProcessReferenceChanged(repo, draft, ['ProcessVariant']);
    assert.equal((await repo.findOne('TestCase', draft)).EndObject, 'SERVICE_QUOTATION');

    // a later extension opens the assignment: no approval, no execution
    await repo.update('TestCase', draft, { ProcessVariant: 'REQUOTE' });
    await service.onProcessReferenceChanged(repo, draft, ['ProcessVariant']);
    const later = await repo.findOne('TestCase', draft);
    assert.equal(later.AssignmentStatus, 'OPEN');
    assert.match(later.AssignmentNote, /later API extension/);
});

test('required test data follows the path: up to the service order no expectation of the billing is needed', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo);
    await repo.update('TestCaseData', draft, { ...GOLDEN, ExpectedNetAmount: null });
    await repo.update('TestCase', draft, { EndObject: 'SERVICE_REQUEST', ProcessVariant: 'W1_REQUEST' });
    await service.onProcessReferenceChanged(repo, draft, ['ProcessVariant', 'EndObject']);
    await repo.update('TestCaseData', draft, { ExpectedNetAmount: null, ServiceProduct: null });
    const { result } = await service.validateTestCase(repo, draft);
    assert.equal(result.overall, 'VALID', 'service product and expected value are not required for the service request only');
    await repo.update('TestCase', draft, { EndObject: 'BILLING_DOCUMENT' });
    const full = await service.validateTestCase(repo, draft);
    assert.equal(full.result.overall, 'INVALID');
    assert.deepEqual(full.result.items.filter((i) => i.ValidationStatus === 'ERROR').map((i) => i.FieldName).sort(), ['ExpectedNetAmount', 'ServiceProduct']);
});

test('way 3: contract determination fills the contract, the billing plan sets the expected value', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo, 'MD_RWM_STOER');
    await repo.update('TestCaseData', draft, {
        SoldToParty: 'MD-100010',
        ServiceRequestReporter: 'MD-CP-1001',
        ServiceRequestDescription: 'RWM Flur: Störung',
        RespyMgmtServiceTeam: 'MD-TEAM-MUC',
        ServiceRefFunctionalLocation: 'LG-0815-NE01',
        ServiceReferenceEquipment: 'RWM-0815-012'
    });
    await repo.update('TestCase', draft, { ProcessVariant: 'W3_CONTRACT' });
    await service.onProcessReferenceChanged(repo, draft, ['ProcessVariant']);
    const data = await repo.findOne('TestCaseData', draft);
    assert.equal(data.ServiceContract, '4100000001', 'contract of the property covers the device in the usage unit');
    assert.equal(data.ExpectedNetAmount, 94);
    assert.equal((await service.validateTestCase(repo, draft)).result.overall, 'VALID');

    await repo.update('TestCase', draft, { ProcessVariant: 'W3_BILLING_PLAN' });
    await service.onProcessReferenceChanged(repo, draft, ['ProcessVariant']);
    assert.equal((await repo.findOne('TestCaseData', draft)).ExpectedNetAmount, 118.8);

    // an expired contract is rejected (R11) with the valid contract as suggestion
    await repo.update('TestCaseData', draft, { ServiceContract: '4100000002' });
    const { result } = await service.validateTestCase(repo, draft);
    const finding = result.items.find((i) => i.FieldName === 'ServiceContract');
    assert.equal(finding.RuleID, 'R11_CONTRACT');
    assert.match(finding.ValidationMessage, /belongs to customer MD-100020.*not valid/);
});

test('mock chain: rejected quotation, contract order, billing plan and FI document', (t) => {
    const { tenantId, tick, repo } = setup();
    t.after(() => teardown(tenantId));
    const run = async (variant, endObject, data, contract) => {
        const { steps } = await model(repo);
        const plan = catalog.executionPlan(steps, variant, endObject);
        const provider = new MockExecutionProvider({ tenantId });
        const contracts = repo.data.ServiceContractVH;
        const id = provider.start(
            { data, processProfile: 'MD_RWM_STOER', plan, serviceContract: contracts.find((c) => c.ServiceContract === contract), referenceLocations: ['LG-0815-NE01', 'LG-0815'] },
            { caseId: 'STC-TEST' }
        ).externalExecutionId;
        tick(30000);
        const status = provider.getStatus(id);
        const documents = provider.getCreatedDocuments(id);
        return {
            status,
            documents,
            verification: verify({
                data,
                documents,
                readDocument: (type, docId) => provider.readDocument(type, docId),
                steps: status.steps,
                executionStatus: status.status,
                technicalResult: provider.getResult(id).technicalResult
            })
        };
    };
    const rwm = { ...GOLDEN, SoldToParty: 'MD-100010', ServiceRefFunctionalLocation: 'LG-0815-NE01', ServiceReferenceEquipment: 'RWM-0815-012', ServiceProduct: 'MD-SRV-RWM', ServiceDuration: 1, ServicePart: 'MD-ERS-RWM', ServicePartQuantity: 1, ExpectedNetAmount: 94 };
    return (async () => {
        const rejected = await run('W2_REJECTED', undefined, rwm);
        assert.equal(rejected.verification.finalResult, 'PASSED');
        assert.deepEqual(rejected.documents.map((d) => d.businessObjectType), ['SERVICE_REQUEST', 'SERVICE_QUOTATION']);
        assert.equal(rejected.documents[1].document.ServiceQuotationIsRejected, true);
        assert.ok(rejected.verification.assertions.some((a) => a.Field === 'SuccessorOrder' && a.Result === 'PASSED'));

        const contract = await run('W3_CONTRACT', 'ACCOUNTING_DOCUMENT', { ...rwm, ServiceContract: '4100000001' }, '4100000001');
        assert.equal(contract.verification.finalResult, 'PASSED');
        const order = contract.documents.find((d) => d.businessObjectType === 'SERVICE_ORDER');
        assert.equal(order.document.ReferenceServiceContract, '4100000001');
        assert.equal(order.predecessorId, '4100000001');
        const fi = contract.documents.find((d) => d.businessObjectType === 'ACCOUNTING_DOCUMENT');
        assert.equal(fi.document.ReferenceDocument, contract.documents.find((d) => d.businessObjectType === 'BILLING_DOCUMENT').documentId);
        assert.ok(contract.verification.assertions.every((a) => a.ProcessStepID));

        const billingPlan = await run('W3_BILLING_PLAN', 'BILLING_DOCUMENT', { ...rwm, ServiceContract: '4100000001', ExpectedNetAmount: 118.8 }, '4100000001');
        assert.equal(billingPlan.verification.finalResult, 'PASSED');
        assert.deepEqual(billingPlan.documents.map((d) => d.businessObjectType), ['SERVICE_CONTRACT', 'BILLING_DOC_REQUEST', 'BILLING_DOCUMENT']);
        assert.equal(billingPlan.documents[1].predecessorId, '4100000001');

        // SIM-9: no valid contract → precondition missing → BLOCKED (not a technical failure)
        const blocked = await run('W3_CONTRACT', undefined, { ...rwm, ServiceContract: '4100000002' }, '4100000002');
        assert.equal(blocked.verification.finalResult, 'BLOCKED');
        assert.equal(blocked.status.steps[0].status, 'FAILED');
        assert.ok(blocked.status.steps.slice(1).every((s) => s.status === 'SKIPPED'));
    })();
});

test('roles are checked server-side: approval needs the process owner, execution the test executor', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    // test case of the quotation team: DEMO_USER has no role there
    const tc = await repo.findOne('TestCase', ACTIVE(SEED.ANGEBOT));
    const check = await service.executionCheck(repo, tc, { user: 'DEMO_USER' });
    assert.equal(check.ok, false);
    assert.equal(check.error.category.name, 'AUTHORIZATION_ERROR');
    assert.equal(check.error.number, 302);
    await assert.rejects(service.startExecution(repo, ACTIVE(SEED.ANGEBOT)), (error) => error.number === 302);
    assert.equal((await service.executionCheck(repo, tc, { user: 'ANG_TESTER' })).ok, true);

    // a test executor without business responsibility may run but not approve
    const draft = await createDraft(repo);
    await repo.update('TestCaseData', draft, GOLDEN);
    await service.validateTestCase(repo, draft);
    const active = await activate(repo, draft);
    await assert.rejects(service.approve(repo, active, 'REP_TESTER'), (error) => error.number === 303 && /process owner/.test(error.message));
    await service.approve(repo, active, 'REP_LEAD');
    assert.equal((await repo.findOne('TestCase', active)).ApprovedVersion, 1);
});

test('versioning: a saved change creates a new version and needs a new approval', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    // seed STC-4 was changed after its run
    const changed = await repo.findOne('TestCase', ACTIVE(SEED.VERSION_2));
    assert.equal(changed.Version, 2);
    assert.equal(changed.ApprovedVersion, 1);
    assert.equal(changed.ApprovalStatus, 'REVOKED');
    const versions = (await repo.find('TestCaseVersion', { TestCaseUUID: SEED.VERSION_2 })).sort((a, b) => a.Version - b.Version);
    assert.deepEqual(versions.map((v) => `${v.Version} ${v.ApprovalStatus} ${v.ChangeSummary}`), ['1 APPROVED Initial version', '2 NOT_APPROVED Changed: Preconditions']);
    const check = await service.executionCheck(repo, changed, { user: 'DEMO_USER' });
    assert.equal(check.ok, false);
    assert.equal(check.error.number, 202);

    // saving without a content change keeps version and approval
    const keys = ACTIVE(SEED.W1_FI);
    const before = await repo.findOne('TestCase', keys);
    const { messages } = await service.onActivated(repo, keys);
    assert.equal(messages.length, 0);
    assert.equal((await repo.findOne('TestCase', keys)).Version, before.Version);
    // a changed test step of an approved test case revokes the approval
    const step = (await repo.find('TestCaseStep', keys))[0];
    await repo.update('TestCaseStep', { TestCaseStepUUID: step.TestCaseStepUUID, IsActiveEntity: true }, { ExpectedResult: 'Service Request mit Referenzobjekt angelegt.' });
    const result = await service.onActivated(repo, keys);
    assert.equal(result.testCase.Version, before.Version + 1);
    assert.equal(result.testCase.ApprovalStatus, 'REVOKED');
    assert.match(result.messages[0].message, /needs a new approval/);
});

test('release: copy scope from the predecessor, regression run with skip reasons, results per step', async (t) => {
    const { repo, tenantId, tick } = setup();
    t.after(() => teardown(tenantId));
    const keys = { ReleaseID: 'S4-2025-FPS02', IsActiveEntity: true };
    await assert.rejects(releaseService.startRegressionRun(repo, keys), (error) => error.number === 251, 'only releases in test');
    const copied = await releaseService.copyScopeFromPredecessor(repo, keys);
    assert.match(copied.messages[0].message, /5 scope entries copied from INT-2026.10/);
    assert.equal((await repo.find('ReleaseScope', { ReleaseID: 'S4-2025-FPS02', IsActiveEntity: true })).length, 5);

    // test start of FPS02 with "Regression at Test Start": the regression run starts automatically
    await repo.update('Release', keys, { ReleaseStatus: 'IN_TEST' });
    const messages = await releaseService.onReleaseActivated(repo, 'S4-2025-FPS02', 'PLANNED');
    assert.match(messages[0].message, /Regression run REG-S4-2025-FPS02-01/);
    const release = await repo.findOne('Release', keys);
    assert.equal(release.LatestRunStatus, 'RUNNING');
    const items = await repo.find('RegressionRunItem', { RunUUID: release.LatestRunUUID });
    const byCase = Object.fromEntries(items.map((i) => [i.CaseID, i]));
    assert.equal(byCase['STC-2026-000007'].Decision, 'STARTED');
    assert.equal(byCase['STC-2026-000010'].Decision, 'STARTED', 'way 3 with contract');
    assert.equal(byCase['STC-2026-000011'].Decision, 'STARTED', 'way 3 billing plan');
    assert.equal(byCase['STC-2026-000012'].Decision, 'SKIPPED');
    assert.match(byCase['STC-2026-000012'].Reason, /test executor/, 'no execution authorization in the quotation team');
    assert.match(byCase['STC-2026-000004'].Reason, /Approve the test case/, 'version 2 is not approved');
    assert.match(byCase['STC-2026-000009'].Reason, /invalid/i);

    tick(60000);
    const refreshed = await releaseService.refreshRegressionRun(repo, keys);
    // started: STC-1, 7, 8, 10, 11 · skipped: STC-3, 6 (not validated), 4 (version 2), 5, 9 (invalid), 12 (role)
    assert.match(refreshed.messages[0].message, /finished: 5 passed, 0 failed, 6 skipped/);
    const done = await repo.findOne('Release', keys);
    assert.equal(done.LatestRunStatus, 'FINISHED');
    assert.equal(done.PassRate, 100);
    const coverage = await repo.find('ReleaseStepCoverage', { ReleaseID: 'S4-2025-FPS02' });
    const status = Object.fromEntries(coverage.map((c) => [c.StepID, c.CoverageStatus]));
    assert.equal(status['REP-050'], 'PASSED', 'contract determination executed');
    assert.equal(status['REP-095'], 'PASSED', 'billing plan executed');
    assert.equal(status['REP-070'], 'MANUAL');
    assert.equal(status['REP-210'], 'LATER');
    const runRows = await repo.find('ReleaseTestCase', { ReleaseID: 'S4-2025-FPS02' });
    const w3 = runRows.find((r) => r.CaseID === 'STC-2026-000010');
    assert.equal(w3.ResultInRelease, 'PASSED');
    assert.equal(w3.RunType, 'REGRESSION');
    const execution = await repo.findOne('Execution', { TestCaseUUID: SEED.W3, ReleaseID: 'S4-2025-FPS02' });
    assert.equal(execution.RegressionRunUUID, release.LatestRunUUID);
});

test('process versioning: a saved change of the process model creates a new version', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const before = await repo.findOne('BusinessProcess', { ProcessID: 'SRV-REP', IsActiveEntity: true });
    assert.equal(before.ProcessVersion, 2);
    assert.equal((await processService.onProcessActivated(repo, 'SRV-REP', 'REP_LEAD')).versioned, false, 'no change, no version');
    const step = (await repo.find('ProcessStep', { ProcessID: 'SRV-REP', StepID: 'REP-090', IsActiveEntity: true }))[0];
    await repo.update('ProcessStep', { ProcessStepUUID: step.ProcessStepUUID, IsActiveEntity: true }, { ResponsibleTeam: 'PT-REPARATUR', TeamAssignment: 'ASSIGNED' });
    await repo.update('BusinessProcess', { ProcessID: 'SRV-REP', IsActiveEntity: true }, { VersionNote: 'Freigabe zur Fakturierung: Team Reparatur bestätigt' });
    const result = await processService.onProcessActivated(repo, 'SRV-REP', 'REP_LEAD');
    assert.deepEqual(result, { versioned: true, version: 3 });
    const versions = await repo.find('ProcessVersion', { ProcessID: 'SRV-REP' });
    assert.equal(versions.length, 3);
    assert.equal((await repo.findOne('ProcessStepVH', { ProcessID: 'SRV-REP', StepID: 'REP-090' })).ResponsibleTeam, 'PT-REPARATUR');
});

test('process hints: way, end object and team from German wording; negated contracts do not select way 3', () => {
    const { processHints } = require('../extraction/processHints');
    assert.equal(processHints('Laut Wartungsvertrag: Rauchwarnmelder piept, Test bis zur Faktura').variant, 'W3_CONTRACT');
    assert.equal(processHints('Laut Wartungsvertrag: Rauchwarnmelder piept, Test bis zur Faktura').endObject, 'BILLING_DOCUMENT');
    assert.equal(processHints('Jahrespauschale über den Rechnungsplan abrechnen').variant, 'W3_BILLING_PLAN');
    assert.equal(processHints('Kostenvoranschlag erstellen, der Kunde lehnt das Angebot ab').variant, 'W2_REJECTED');
    assert.equal(processHints('Bitte ein Angebot machen, bis zum Auftrag').endObject, 'SERVICE_ORDER');
    assert.equal(processHints('Heizkostenverteiler defekt, kein Wartungsvertrag vorhanden', { meteringFault: true }).variant, 'W1_REQUEST');
    assert.equal(processHints('Prozessteam Angebot testet das Angebot').team, 'PT-ANGEBOT');
    assert.equal(processHints('Display dunkel').variant, undefined);
});

test('"run up to" outside the way is replaced by the end of the way and reported at the field', async (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const draft = await createDraft(repo);
    await repo.update('TestCase', draft, { ProcessVariant: 'W2_REJECTED' });
    await service.onProcessReferenceChanged(repo, draft, ['ProcessVariant']);
    const tc = await repo.findOne('TestCase', draft);
    assert.equal(tc.EndObject, 'SERVICE_QUOTATION');
    assert.equal(tc.SAP__Messages.length, 1);
    assert.equal(tc.SAP__Messages[0].code, 'ZSTC_TA/109');
    assert.equal(tc.SAP__Messages[0].target, 'EndObject');
    assert.match(tc.SAP__Messages[0].message, /Billing Document is not on way W2_REJECTED: the run now goes up to Service Quotation/);
    // an end object on the way is kept without a message
    await repo.update('TestCase', draft, { ProcessVariant: 'W2_QUOTATION', EndObject: 'SERVICE_ORDER' });
    await service.onProcessReferenceChanged(repo, draft, ['ProcessVariant', 'EndObject']);
    const kept = await repo.findOne('TestCase', draft);
    assert.equal(kept.EndObject, 'SERVICE_ORDER');
    assert.deepEqual(kept.SAP__Messages, []);
});
