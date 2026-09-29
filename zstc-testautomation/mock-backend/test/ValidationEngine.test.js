'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../validation/ValidationEngine');
const { setup, teardown, pools, GOLDEN } = require('./helpers');

function requirementsOf(repo, profile) {
    return repo.data.FieldRequirement.filter((r) => r.ProcessProfile === profile && r.IsActiveEntity);
}

test('golden test case H2-STC-001 is VALID with FS_TM', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const result = validate({ testCase: { ProcessProfile: 'FS_TM' }, data: GOLDEN, requirements: requirementsOf(repo, 'FS_TM'), pools: pools(repo) });
    assert.equal(result.overall, 'VALID', JSON.stringify(result.items.filter((i) => i.ValidationStatus !== 'SUCCESS')));
    assert.equal(result.counts.error, 0);
    assert.equal(result.counts.warning, 0);
    assert.ok(result.counts.success >= 20);
});

test('R4: EL-200 at H2POWC00-PROD is an ERROR with suggestions EL-100 and EL-101 (DoD-4)', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const result = validate({
        testCase: { ProcessProfile: 'FS_TM' },
        data: { ...GOLDEN, ServiceReferenceEquipment: 'EL-200', ReferenceProduct: 'P700-EL-200' },
        requirements: requirementsOf(repo, 'FS_TM'),
        pools: pools(repo)
    });
    assert.equal(result.overall, 'INVALID');
    const finding = result.items.find((i) => i.FieldName === 'ServiceReferenceEquipment');
    assert.equal(finding.ValidationStatus, 'ERROR');
    assert.equal(finding.RuleID, 'R4_FL_EQUIPMENT');
    assert.equal(finding.target, '_TestCaseData/ServiceReferenceEquipment');
    assert.deepEqual(finding.SuggestedValues.split(', '), ['EL-100', 'EL-101']);
    // findings are sorted: errors first
    assert.equal(result.items[0].ValidationStatus, 'ERROR');
});

test('R1 is driven by FieldRequirement: a missing reporter is an ERROR only while it is required (DoD-6)', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const data = { ...GOLDEN, ServiceRequestReporter: null };
    const required = validate({ testCase: {}, data, requirements: requirementsOf(repo, 'FS_TM'), pools: pools(repo) });
    const finding = required.items.find((i) => i.FieldName === 'ServiceRequestReporter');
    assert.equal(finding.ValidationStatus, 'ERROR');
    assert.equal(finding.RuleID, 'R1_REQUIRED');
    assert.match(finding.SuggestedValues, /CP-700001/);

    const optional = requirementsOf(repo, 'FS_TM').map((r) => (r.FieldName === 'ServiceRequestReporter' ? { ...r, Required: false } : r));
    const result = validate({ testCase: {}, data, requirements: optional, pools: pools(repo) });
    assert.equal(result.overall, 'VALID');
    assert.equal(result.items.find((i) => i.FieldName === 'ServiceRequestReporter'), undefined);
});

test('R2 existence: unknown customer with fuzzy suggestions', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const result = validate({ testCase: {}, data: { ...GOLDEN, SoldToParty: 'C700-C0' }, requirements: requirementsOf(repo, 'FS_TM'), pools: pools(repo) });
    const finding = result.items.find((i) => i.FieldName === 'SoldToParty');
    assert.equal(finding.ValidationStatus, 'ERROR');
    assert.equal(finding.RuleID, 'R2_EXISTS');
    assert.ok(finding.SuggestedValues.startsWith('C700-C00'));
});

test('R3/R5/R6/R8 relationship and type rules', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const req = requirementsOf(repo, 'FS_TM');
    const find = (data, field) => validate({ testCase: {}, data: { ...GOLDEN, ...data }, requirements: req, pools: pools(repo) }).items.find((i) => i.FieldName === field);
    assert.equal(find({ ServiceRefFunctionalLocation: 'H2POWC01-PROD', ServiceReferenceEquipment: 'EL-200', ReferenceProduct: 'P700-EL-200' }, 'ServiceRefFunctionalLocation').RuleID, 'R3_CUSTOMER_FL');
    assert.equal(find({ ReferenceProduct: 'P700-EL-200' }, 'ReferenceProduct').RuleID, 'R5_EQUIPMENT_PRODUCT');
    assert.equal(find({ ServiceProduct: 'P700-SC-100' }, 'ServiceProduct').RuleID, 'R6_PRODUCT_TYPE');
    assert.equal(find({ ServiceDurationUnit: 'PC' }, 'ServiceDurationUnit').ValidationStatus, 'ERROR');
    const reporter = find({ ServiceRequestReporter: 'CP-700102' }, 'ServiceRequestReporter');
    assert.equal(reporter.ValidationStatus, 'WARNING');
    assert.equal(reporter.RuleID, 'R8_CONTACT_CUSTOMER');
});

test('R7: an unconfirmed ambiguous extraction keeps the test case AMBIGUOUS', (t) => {
    const { repo, tenantId } = setup();
    t.after(() => teardown(tenantId));
    const extraction = [
        { FieldName: 'ServiceReferenceEquipment', ValidationStatus: 'WARNING', ResolvedValue: '', ProposedValue: 'EL-100', SuggestedValues: 'EL-100, EL-101' }
    ];
    const result = validate({ testCase: {}, data: GOLDEN, requirements: requirementsOf(repo, 'FS_TM'), pools: pools(repo), extraction });
    assert.equal(result.overall, 'AMBIGUOUS');
    const finding = result.items.find((i) => i.FieldName === 'ServiceReferenceEquipment');
    assert.equal(finding.RuleID, 'R7_AMBIGUOUS');
    assert.equal(finding.SuggestedValue, 'EL-100');
    assert.equal(finding.ResolvedValue, '');
});
