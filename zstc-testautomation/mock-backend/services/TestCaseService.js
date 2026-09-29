'use strict';
/**
 * TestCaseService — behavior of the facade BO "test case" in the mockup (stand-in for the RAP behavior
 * implementation of ZUI_STC_TEST_CASE_O4): determinations, validations, feature control and the actions
 * analyze · validate · approve · startExecution · refreshExecution · cancelExecution · revalidate · applySuggestion.
 *
 * All functions work on a repository (mock server entity interfaces or in-memory) and are free of mock server APIs,
 * so they are unit-testable and run unchanged in the browser-hosted variant.
 */
const { validate: runValidation, FIELD_BY_NAME, isEmpty } = require('../validation/ValidationEngine');
const { MockTestCaseExtractionService } = require('../extraction/MockTestCaseExtractionService');
const { getProvider } = require('../execution/MockExecutionProvider');
const { verify } = require('../verification/VerificationService');
const numberRanges = require('../common/numberRanges');
const clock = require('../common/clock');
const { VALIDATION, APPROVAL, EXECUTION, RESULT, LIFECYCLE, ITEM_STATUS, STEP_STATUS, criticalityOf } = require('../common/codes');
const { CATEGORY, SEVERITY, sapMessage, MockServiceError } = require('../common/messages');

/** Mock identity of the logged-on user (no authentication in the mockup) */
const CURRENT_USER = 'DEMO_USER';
const DEFAULT_PROCESS_PROFILE = 'FS_TM';

const CONTROLLED_FIELDS = [
    'ServiceRequestType',
    'ServiceRequestDescription',
    'SoldToParty',
    'ServiceRequestReporter',
    'ServiceDocumentPriority',
    'SalesOrganization',
    'ServiceOrganization',
    'RespyMgmtServiceTeam',
    'ServiceProfile',
    'ResponseProfile',
    'RequestedServiceStartDateTime',
    'RequestedServiceEndDateTime',
    'ServiceRefFunctionalLocation',
    'ServiceReferenceEquipment',
    'ReferenceProduct',
    'ServiceProduct',
    'ServiceDuration',
    'ServiceDurationUnit',
    'ServicePart',
    'ServicePartQuantity',
    'ServicePartQuantityUnit',
    'ExpectedNetAmount',
    'NetAmountTolerance',
    'TransactionCurrency'
];
const NUMERIC_FIELDS = new Set(['ServiceDuration', 'ServicePartQuantity', 'ExpectedNetAmount', 'NetAmountTolerance']);

const extractionService = new MockTestCaseExtractionService();
const uuid = () => globalThis.crypto.randomUUID();
const tcKeys = (tc) => ({ TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: tc.IsActiveEntity });

/* ------------------------------------------------------------------------------------------------ */
/* Reading helpers                                                                                   */
/* ------------------------------------------------------------------------------------------------ */
async function loadPools(repo) {
    const [customers, contacts, functionalLocations, equipments, products, salesOrganizations, serviceOrganizations, serviceTeams, priorities, requestTypes, units, currencies, processProfiles, fields] =
        await Promise.all(
            [
                'CustomerVH',
                'ContactPersonVH',
                'FunctionalLocationVH',
                'EquipmentVH',
                'ProductVH',
                'SalesOrganizationVH',
                'ServiceOrganizationVH',
                'ServiceTeamVH',
                'ServiceDocumentPriorityVH',
                'ServiceRequestTypeVH',
                'UnitOfMeasureVH',
                'CurrencyVH',
                'ProcessProfileVH',
                'TestCaseFieldVH'
            ].map((set) => repo.find(set))
        );
    const fieldLabels = Object.fromEntries(fields.map((f) => [f.FieldName, f.FieldLabel]));
    return {
        pools: { customers, contacts, functionalLocations, equipments, products, salesOrganizations, serviceOrganizations, serviceTeams, priorities, requestTypes, units, currencies, processProfiles },
        fieldLabels
    };
}

async function getTestCase(repo, keys) {
    const tc = await repo.findOne('TestCase', { TestCaseUUID: keys.TestCaseUUID, IsActiveEntity: keys.IsActiveEntity });
    if (!tc) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 299, `Test case ${keys.TestCaseUUID} not found.`);
    }
    return tc;
}

async function getData(repo, tc) {
    return (await repo.findOne('TestCaseData', tcKeys(tc))) || {};
}

async function getRequirements(repo, processProfile) {
    if (!processProfile) {
        return [];
    }
    return repo.find('FieldRequirement', { ProcessProfile: processProfile, IsActiveEntity: true });
}

async function getProfile(repo, processProfile) {
    return repo.findOne('ProcessProfile', { ProcessProfile: processProfile, IsActiveEntity: true });
}

/* ------------------------------------------------------------------------------------------------ */
/* Derived state and feature control (read-time, like RAP virtual elements / instance feature control) */
/* ------------------------------------------------------------------------------------------------ */
function lifecycleStatus(tc) {
    if (tc.ExecutionStatus === EXECUTION.RUNNING) {
        return LIFECYCLE.IN_EXECUTION;
    }
    if (tc.ExecutionStatus === EXECUTION.FINISHED || tc.ExecutionStatus === EXECUTION.FAILED) {
        return LIFECYCLE.COMPLETED;
    }
    if (tc.ExecutionStatus === EXECUTION.CANCELLED) {
        return LIFECYCLE.CANCELLED;
    }
    if (tc.ApprovalStatus === APPROVAL.APPROVED) {
        return LIFECYCLE.APPROVED;
    }
    if (tc.ValidationStatus === VALIDATION.VALID) {
        return LIFECYCLE.VALIDATED;
    }
    return LIFECYCLE.CAPTURED;
}

/**
 * Computes status criticalities, lifecycle status, __OperationControl and __EntityControl.
 *
 * @param {object} tc TestCase entry
 * @returns {object} derived fields
 */
function deriveTestCase(tc) {
    const status = lifecycleStatus(tc);
    const isDraft = tc.IsActiveEntity === false;
    const lockedByDraft = tc.IsActiveEntity !== false && tc.HasDraftEntity === true;
    const running = tc.ExecutionStatus === EXECUTION.RUNNING;
    return {
        Status: status,
        StatusCriticality: criticalityOf(status),
        ValidationCriticality: criticalityOf(tc.ValidationStatus),
        ApprovalCriticality: criticalityOf(tc.ApprovalStatus),
        ExecutionCriticality: criticalityOf(tc.ExecutionStatus),
        FinalResultCriticality: criticalityOf(tc.FinalResult),
        __OperationControl: {
            analyze: isDraft,
            validate: isDraft,
            approve: !isDraft && !lockedByDraft && !running && tc.ValidationStatus === VALIDATION.VALID && tc.ApprovalStatus !== APPROVAL.APPROVED,
            startExecution: !isDraft && !lockedByDraft && !running && tc.ApprovalStatus === APPROVAL.APPROVED,
            refreshExecution: !isDraft && running,
            cancelExecution: !isDraft && running,
            revalidate: !isDraft && !lockedByDraft && !running && tc.ValidationStatus !== VALIDATION.NOT_VALIDATED
        },
        __EntityControl: {
            Updatable: !running,
            Deletable: !running && (tc.ExecutionStatus || EXECUTION.NOT_STARTED) === EXECUTION.NOT_STARTED
        }
    };
}

/**
 * Dynamic field control from the customizing table FieldRequirement: 7 mandatory · 3 optional · 0 hidden.
 *
 * @param {object[]} requirements FieldRequirement rows of the process profile
 * @returns {object} __FieldControl
 */
function fieldControl(requirements) {
    const byField = new Map(requirements.map((r) => [r.FieldName, r]));
    const control = {};
    for (const field of CONTROLLED_FIELDS) {
        const req = byField.get(field);
        control[field] = !req ? 3 : req.Active === false ? 0 : req.Required ? 7 : 3;
    }
    return control;
}

/**
 * Instance feature control of a validation finding: applySuggestion only in edit mode for an open finding with a suggestion.
 *
 * @param {object} row ValidationResult entry
 * @returns {object} derived fields
 */
function deriveValidationResult(row) {
    return {
        __OperationControl: {
            // an applied suggestion turns the finding into INFO, so the action disappears
            applySuggestion:
                row.IsActiveEntity === false &&
                !isEmpty(row.SuggestedValue) &&
                (row.ValidationStatus === ITEM_STATUS.ERROR || row.ValidationStatus === ITEM_STATUS.WARNING)
        }
    };
}

/**
 * Persists the derived state (status, criticality, feature control) of all versions (active and draft) of a test case,
 * so that $filter, $orderby and $select on these properties work like on persisted RAP fields.
 *
 * @param {object} repo repository
 * @param {string} testCaseUUID test case UUID
 */
async function syncDerived(repo, testCaseUUID) {
    const versions = await repo.find('TestCase', { TestCaseUUID: testCaseUUID });
    for (const tc of versions) {
        await repo.update('TestCase', tcKeys(tc), deriveTestCase(tc));
        if (await repo.findOne('TestCaseData', tcKeys(tc))) {
            await repo.update('TestCaseData', tcKeys(tc), { __FieldControl: fieldControl(await getRequirements(repo, tc.ProcessProfile)) });
        }
        for (const row of await repo.find('ValidationResult', tcKeys(tc))) {
            await repo.update('ValidationResult', { ValidationUUID: row.ValidationUUID, IsActiveEntity: row.IsActiveEntity }, deriveValidationResult(row));
        }
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* Determinations                                                                                    */
/* ------------------------------------------------------------------------------------------------ */
function initialTestCase(tc) {
    return {
        ProcessProfile: tc.ProcessProfile || DEFAULT_PROCESS_PROFILE,
        ValidationStatus: VALIDATION.NOT_VALIDATED,
        ApprovalStatus: APPROVAL.NOT_APPROVED,
        ExecutionStatus: EXECUTION.NOT_STARTED,
        FinalResult: RESULT.NONE,
        CreatedBy: CURRENT_USER,
        CreatedAt: clock.nowIso(),
        ChangedAt: clock.nowIso(),
        SAP__Messages: []
    };
}

/** Creates the 1:1 child TestCaseData for a new draft with the default values of the customizing */
async function createTestData(repo, tc) {
    const requirements = await getRequirements(repo, tc.ProcessProfile || DEFAULT_PROCESS_PROFILE);
    // every property is part of the entity (null when empty): OData responses must contain all selected properties
    const data = {
        TestCaseUUID: tc.TestCaseUUID,
        IsActiveEntity: false,
        HasActiveEntity: false,
        HasDraftEntity: false,
        DraftAdministrativeData: null,
        ...Object.fromEntries(CONTROLLED_FIELDS.map((field) => [field, null])),
        SalesOrganizationOrgUnitID: '',
        __FieldControl: fieldControl(requirements)
    };
    for (const req of requirements) {
        if (!isEmpty(req.DefaultValue) && req.Active !== false && CONTROLLED_FIELDS.includes(req.FieldName)) {
            data[req.FieldName] = NUMERIC_FIELDS.has(req.FieldName) ? Number(req.DefaultValue) : req.DefaultValue;
        }
    }
    await repo.add('TestCaseData', data);
    return data;
}

/**
 * Determinations on the test data (RAP: determination on modify).
 * The reference product is derived from the equipment (source DERIVED): it is set when empty and re-derived whenever
 * the equipment changes; a reference product the user maintains afterwards is kept and checked by rule R5.
 *
 * @param {object} repo repository
 * @param {object} data TestCaseData entry
 * @param {object} pools value help pools
 * @param {string[]} [changedFields] fields changed by the triggering modification
 * @returns {Promise<object>} applied patch
 */
async function determineTestData(repo, data, pools, changedFields = []) {
    const patch = {};
    const equipment = pools.equipments.find((e) => e.Equipment === data.ServiceReferenceEquipment);
    if (equipment && (isEmpty(data.ReferenceProduct) || changedFields.includes('ServiceReferenceEquipment')) && data.ReferenceProduct !== equipment.Material) {
        patch.ReferenceProduct = equipment.Material;
    }
    if (equipment && isEmpty(data.ServiceRefFunctionalLocation)) {
        patch.ServiceRefFunctionalLocation = equipment.FunctionalLocation;
    }
    const salesOrgUnit = data.SalesOrganization ? `O ${String(50000000 + Number(String(data.SalesOrganization).replace(/\D/g, '') || 0))}` : '';
    if ((data.SalesOrganizationOrgUnitID || '') !== salesOrgUnit) {
        patch.SalesOrganizationOrgUnitID = salesOrgUnit;
    }
    if (Object.keys(patch).length) {
        await repo.update('TestCaseData', { TestCaseUUID: data.TestCaseUUID, IsActiveEntity: data.IsActiveEntity }, patch);
    }
    return patch;
}

/**
 * Called after the user changed test data (PATCH): re-derives values, invalidates the validation result and
 * a previous approval, and removes the state messages of the changed fields.
 */
async function onTestDataChanged(repo, dataKeys, changedFields) {
    const data = await repo.findOne('TestCaseData', dataKeys);
    if (!data) {
        return;
    }
    const { pools } = await loadPools(repo);
    await determineTestData(repo, data, pools, changedFields);
    const tc = await repo.findOne('TestCase', dataKeys);
    if (!tc) {
        return;
    }
    const targets = new Set(changedFields.map((f) => `_TestCaseData/${f}`));
    await repo.update('TestCase', tcKeys(tc), {
        ValidationStatus: VALIDATION.NOT_VALIDATED,
        ApprovalStatus: tc.ApprovalStatus === APPROVAL.APPROVED ? APPROVAL.REVOKED : tc.ApprovalStatus,
        SAP__Messages: (tc.SAP__Messages || []).filter((m) => !targets.has(m.target)),
        ChangedAt: clock.nowIso()
    });
}

/** Called after the process profile of a draft changed */
async function onProcessProfileChanged(repo, tc) {
    await repo.update('TestCase', tcKeys(tc), { ValidationStatus: VALIDATION.NOT_VALIDATED, SAP__Messages: [], ChangedAt: clock.nowIso() });
}

/** RAP: late numbering on activation — assigns the Case ID */
async function onActivated(repo, keys) {
    const tc = await repo.findOne('TestCase', { TestCaseUUID: keys.TestCaseUUID, IsActiveEntity: true });
    if (!tc) {
        return undefined;
    }
    const patch = { SAP__Messages: [], ChangedAt: clock.nowIso() };
    if (isEmpty(tc.CaseID)) {
        patch.CaseID = numberRanges.nextCaseId(repo.tenantId);
    }
    return repo.update('TestCase', tcKeys(tc), patch);
}

/* ------------------------------------------------------------------------------------------------ */
/* Validation                                                                                        */
/* ------------------------------------------------------------------------------------------------ */
async function replaceValidationRows(repo, tc, items) {
    const existing = await repo.find('ValidationResult', { TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: tc.IsActiveEntity });
    for (const row of existing) {
        await repo.remove('ValidationResult', { ValidationUUID: row.ValidationUUID, IsActiveEntity: row.IsActiveEntity });
    }
    for (const item of items) {
        const { target, ...fields } = item;
        void target;
        await repo.add('ValidationResult', {
            ValidationUUID: uuid(),
            TestCaseUUID: tc.TestCaseUUID,
            IsActiveEntity: tc.IsActiveEntity,
            HasActiveEntity: false,
            HasDraftEntity: false,
            DraftAdministrativeData: null,
            ...fields
        });
    }
}

/**
 * State messages per field (worst severity wins) for errors and warnings — they mark the fields and fill the message
 * popover. Validated fields (SUCCESS) are listed in the section "Validation Issues" only.
 */
function stateMessages(items) {
    const severityOf = { ERROR: SEVERITY.ERROR, WARNING: SEVERITY.WARNING, INFO: SEVERITY.INFO, SUCCESS: SEVERITY.SUCCESS };
    const byTarget = new Map();
    for (const item of items.filter((i) => i.ValidationStatus === 'ERROR' || i.ValidationStatus === 'WARNING')) {
        const current = byTarget.get(item.target);
        if (!current || severityOf[item.ValidationStatus] > severityOf[current.ValidationStatus]) {
            byTarget.set(item.target, item);
        }
    }
    const number = { ERROR: 101, WARNING: 102, SUCCESS: 901, INFO: 902 };
    return [...byTarget.values()].map((item) =>
        sapMessage(number[item.ValidationStatus], item.ValidationMessage, { severity: severityOf[item.ValidationStatus], target: item.target, transition: false })
    );
}

/**
 * Runs the deterministic validation and persists the findings.
 *
 * @param {object} repo repository
 * @param {object} keys TestCase keys
 * @param {object} [options] options
 * @param {boolean} [options.asStateMessages] return state messages (edit mode) instead of transition messages
 * @returns {Promise<{testCase: object, result: object, messages: object[]}>} result
 */
async function validateTestCase(repo, keys, { asStateMessages = true } = {}) {
    const tc = await getTestCase(repo, keys);
    const data = await getData(repo, tc);
    const { pools, fieldLabels } = await loadPools(repo);
    const requirements = await getRequirements(repo, tc.ProcessProfile);
    const extraction = (await repo.find('ValidationResult', { TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: tc.IsActiveEntity })).filter(
        (row) => row.Category === 'EXTRACTION'
    );
    const result = runValidation({ testCase: tc, data, requirements, pools, extraction, fieldLabels });
    await replaceValidationRows(repo, tc, result.items);
    const patch = { ValidationStatus: result.overall, ChangedAt: clock.nowIso() };
    if (result.overall !== VALIDATION.VALID && tc.ApprovalStatus === APPROVAL.APPROVED) {
        patch.ApprovalStatus = APPROVAL.REVOKED;
    }
    const summary = `Validation finished: ${result.counts.success} fields validated · ${result.counts.warning} warnings · ${result.counts.error} errors.`;
    const summarySeverity = result.counts.error ? SEVERITY.ERROR : result.counts.warning ? SEVERITY.WARNING : SEVERITY.SUCCESS;
    const messages = [];
    if (asStateMessages) {
        patch.SAP__Messages = stateMessages(result.items);
        messages.push(sapMessage(result.counts.error ? 103 : result.counts.warning ? 104 : 903, summary, { severity: summarySeverity }));
    } else {
        patch.SAP__Messages = [];
        messages.push(sapMessage(result.counts.error ? 103 : result.counts.warning ? 104 : 903, summary, { severity: summarySeverity }));
        if (patch.ApprovalStatus === APPROVAL.REVOKED) {
            messages.push(sapMessage(105, 'The approval was revoked because the test data is no longer valid.', { severity: SEVERITY.WARNING }));
        }
    }
    const updated = await repo.update('TestCase', tcKeys(tc), patch);
    return { testCase: updated, result, messages };
}

/**
 * Draft Prepare (RAP: determine action Prepare): validates the test data on save so the saved test case always carries
 * a current validation status. Saving is not blocked — an invalid test case can be kept, but not approved.
 *
 * @param {object} repo repository
 * @param {object} keys draft keys
 * @returns {Promise<object[]>} transition messages (only if the test data is not valid)
 */
async function prepare(repo, keys) {
    const tc = await repo.findOne('TestCase', keys);
    if (!tc) {
        return [];
    }
    const { result } = await validateTestCase(repo, keys, { asStateMessages: false });
    await repo.update('TestCase', tcKeys(tc), { SAP__Messages: [] });
    if (result.overall === VALIDATION.VALID) {
        return [];
    }
    return [
        sapMessage(
            107,
            `The test case was saved with validation status ${result.overall}: ${result.counts.error} errors, ${result.counts.warning} warnings. Resolve them before approval.`,
            { severity: SEVERITY.WARNING }
        )
    ];
}

/* ------------------------------------------------------------------------------------------------ */
/* Actions                                                                                           */
/* ------------------------------------------------------------------------------------------------ */
async function analyze(repo, keys) {
    const tc = await getTestCase(repo, keys);
    if (isEmpty(tc.NaturalLanguageInput)) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 201, 'Describe the test scenario first, then run Analyze.', 'NaturalLanguageInput');
    }
    const data = await getData(repo, tc);
    const { pools, fieldLabels } = await loadPools(repo);
    const { proposals } = extractionService.extract(tc.NaturalLanguageInput, pools);
    const patch = {};
    const rows = [];
    let filled = 0;
    let kept = 0;
    for (const proposal of proposals) {
        const meta = FIELD_BY_NAME.get(proposal.field);
        const label = fieldLabels[proposal.field] || proposal.field;
        const current = data[proposal.field];
        const keepUserValue = !isEmpty(current) && String(current) !== String(proposal.value);
        if (!keepUserValue) {
            patch[proposal.field] = proposal.value;
            filled++;
        } else {
            kept++;
        }
        const ambiguous = proposal.status === 'WARNING';
        rows.push({
            BusinessObjectType: meta ? meta.bo : 'SERVICE_REQUEST',
            Category: 'EXTRACTION',
            FieldName: proposal.field,
            ProposedValue: String(proposal.value),
            ResolvedValue: keepUserValue ? String(current) : '',
            SuggestedValue: ambiguous ? String(proposal.candidates[0]) : '',
            SuggestedValues: ambiguous ? proposal.candidates.join(', ') : '',
            Source: proposal.source,
            RuleID: ambiguous ? 'R7_AMBIGUOUS' : 'NONE',
            ValidationStatus: keepUserValue ? ITEM_STATUS.INFO : ambiguous ? ITEM_STATUS.WARNING : ITEM_STATUS.SUCCESS,
            Criticality: criticalityOf(keepUserValue ? ITEM_STATUS.INFO : ambiguous ? ITEM_STATUS.WARNING : ITEM_STATUS.SUCCESS),
            ValidationMessage: keepUserValue
                ? `${label}: your value "${current}" was kept; the description suggests "${proposal.value}".`
                : ambiguous
                  ? `${label}: "${proposal.matchedText}" matches ${proposal.candidates.length} values (${proposal.candidates.join(', ')}); "${proposal.value}" was proposed. Confirm or choose another value.`
                  : `${label}: "${proposal.value}" ${proposal.source === 'DERIVED' ? `derived from ${proposal.matchedText}` : 'taken from the description'}.`,
            Severity: ambiguous ? ITEM_STATUS.WARNING : ITEM_STATUS.SUCCESS,
            target: `_TestCaseData/${proposal.field}`
        });
    }
    rows.forEach((row, index) => {
        row.Sequence = index + 1;
    });
    if (Object.keys(patch).length) {
        await repo.update('TestCaseData', tcKeys(tc), patch);
        await determineTestData(repo, { ...data, ...patch }, pools, Object.keys(patch));
    }
    await replaceValidationRows(repo, tc, rows);
    const ambiguousCount = rows.filter((r) => r.ValidationStatus === ITEM_STATUS.WARNING).length;
    const testCasePatch = { ValidationStatus: VALIDATION.NOT_VALIDATED, SAP__Messages: [], ChangedAt: clock.nowIso() };
    // determination: an empty title is taken from the problem description
    const description = patch.ServiceRequestDescription || data.ServiceRequestDescription;
    if (isEmpty(tc.Title) && !isEmpty(description)) {
        testCasePatch.Title = String(description).slice(0, 80);
    }
    const updated = await repo.update('TestCase', tcKeys(tc), testCasePatch);
    const text =
        proposals.length === 0
            ? 'Analyze (mock keyword matching) found no known master data in the description.'
            : `Analyze (mock keyword matching) filled ${filled} fields${kept ? `, kept ${kept} of your values` : ''}${ambiguousCount ? `, ${ambiguousCount} ambiguous` : ''}. Run Validate to check the test data.`;
    return { testCase: updated, messages: [sapMessage(ambiguousCount ? 106 : 904, text, { severity: ambiguousCount ? SEVERITY.WARNING : SEVERITY.SUCCESS })] };
}

async function approve(repo, keys) {
    const tc = await getTestCase(repo, keys);
    if (tc.ValidationStatus !== VALIDATION.VALID) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 203, 'Only valid test cases can be approved. Run Validate and resolve all findings first.');
    }
    if (tc.ExecutionStatus === EXECUTION.RUNNING) {
        throw new MockServiceError(CATEGORY.EXECUTION_ERROR, 402, 'The test case cannot be approved while an execution is running.');
    }
    const profile = await getProfile(repo, tc.ProcessProfile);
    if (profile && profile.RequiresSecondApprover && tc.CreatedBy === CURRENT_USER) {
        throw new MockServiceError(
            CATEGORY.AUTHORIZATION_ERROR,
            301,
            `Four-eyes principle (process profile ${tc.ProcessProfile}): ${CURRENT_USER} created this test case and cannot approve it. A second person has to approve it.`
        );
    }
    const updated = await repo.update('TestCase', tcKeys(tc), { ApprovalStatus: APPROVAL.APPROVED, ApprovedBy: CURRENT_USER, ApprovedAt: clock.nowIso(), ChangedAt: clock.nowIso() });
    return { testCase: updated, messages: [sapMessage(905, 'Test case approved. You can start the execution now.', { severity: SEVERITY.SUCCESS })] };
}

async function startExecution(repo, keys) {
    const tc = await getTestCase(repo, keys);
    if (tc.ApprovalStatus !== APPROVAL.APPROVED) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 202, 'Approve the test case before starting the execution.');
    }
    if (tc.ExecutionStatus === EXECUTION.RUNNING) {
        throw new MockServiceError(CATEGORY.EXECUTION_ERROR, 401, `Execution ${tc.ExternalExecutionID} is still running for this test case.`);
    }
    const profile = await getProfile(repo, tc.ProcessProfile);
    const providerCode = (profile && profile.ExecutionProvider) || 'MOCK';
    const provider = getProvider(providerCode, repo.tenantId);
    if (!provider) {
        throw new MockServiceError(
            CATEGORY.TECHNICAL_ERROR,
            502,
            `Execution provider ${providerCode} is not connected in this mockup (real test automation interface to be clarified, open point F-8).`
        );
    }
    const data = await getData(repo, tc);
    // hand over the validated data set only (no technical draft fields)
    const dataset = Object.fromEntries([...CONTROLLED_FIELDS, 'SalesOrganizationOrgUnitID'].filter((f) => !isEmpty(data[f])).map((f) => [f, data[f]]));
    let externalExecutionId;
    try {
        ({ externalExecutionId } = provider.start({ data: dataset, processProfile: tc.ProcessProfile }, { caseId: tc.CaseID, soldToParty: data.SoldToParty }));
    } catch (error) {
        throw new MockServiceError(CATEGORY.TECHNICAL_ERROR, 501, error.message);
    }
    const executionUUID = uuid();
    const now = clock.nowIso();
    const status = provider.getStatus(externalExecutionId);
    await repo.add('Execution', {
        ExecutionUUID: executionUUID,
        TestCaseUUID: tc.TestCaseUUID,
        IsActiveEntity: true,
        HasActiveEntity: false,
        HasDraftEntity: false,
        DraftAdministrativeData: null,
        ExecutionProvider: providerCode,
        ExternalExecutionID: externalExecutionId,
        CorrelationReference: tc.CaseID,
        Status: EXECUTION.RUNNING,
        StatusCriticality: criticalityOf(EXECUTION.RUNNING),
        ProgressPercent: 0,
        StartedAt: now,
        FinishedAt: null,
        DurationInSeconds: null,
        TechnicalResult: '',
        FunctionalResult: '',
        FunctionalResultCriticality: 0,
        TechnicalLog: provider.getResult(externalExecutionId).log.join('\n')
    });
    for (const step of status.steps) {
        await repo.add('ExecutionStep', {
            StepUUID: uuid(),
            ExecutionUUID: executionUUID,
            TestCaseUUID: tc.TestCaseUUID,
            IsActiveEntity: true,
            HasActiveEntity: false,
            HasDraftEntity: false,
            DraftAdministrativeData: null,
            Sequence: step.sequence,
            BusinessObjectType: step.businessObjectType,
            ExpectedStatus: step.expectedStatus,
            ActualStatus: '',
            ExecutionStatus: step.status,
            Criticality: criticalityOf(step.status),
            StartedAt: step.startedAt,
            FinishedAt: null,
            Message: ''
        });
    }
    const updated = await repo.update('TestCase', tcKeys(tc), {
        ExecutionStatus: EXECUTION.RUNNING,
        FinalResult: RESULT.NONE,
        ExternalExecutionID: externalExecutionId,
        ExecutionStartedAt: now,
        ExecutionFinishedAt: null,
        ExecutionDuration: null,
        LatestExecutionUUID: executionUUID,
        ChangedAt: now
    });
    return {
        testCase: updated,
        messages: [
            sapMessage(
                906,
                `Execution ${externalExecutionId} started via MockExecutionProvider (simulation, no SAP test automation). The status refreshes automatically.`,
                // success → message toast; information would open a modal dialog in SAP Fiori elements
                { severity: SEVERITY.SUCCESS }
            )
        ]
    };
}

/** Synchronizes provider status, steps, documents and — when finished — assertions and final result */
async function refreshExecution(repo, keys, { cancel = false } = {}) {
    const tc = await getTestCase(repo, keys);
    if (tc.ExecutionStatus !== EXECUTION.RUNNING || !tc.LatestExecutionUUID) {
        return { testCase: tc, messages: [] };
    }
    const execution = await repo.findOne('Execution', { ExecutionUUID: tc.LatestExecutionUUID, IsActiveEntity: true });
    const provider = getProvider(execution.ExecutionProvider, repo.tenantId);
    if (!provider || !provider.runs?.has(execution.ExternalExecutionID)) {
        // mock runs live in memory: after a restart the run cannot be continued
        await repo.update('Execution', { ExecutionUUID: execution.ExecutionUUID, IsActiveEntity: true }, { Status: EXECUTION.FAILED, StatusCriticality: criticalityOf(EXECUTION.FAILED), TechnicalResult: 'ERROR' });
        const updated = await repo.update('TestCase', tcKeys(tc), { ExecutionStatus: EXECUTION.FAILED, FinalResult: RESULT.FAILED_TECHNICAL, ExecutionFinishedAt: clock.nowIso() });
        throw Object.assign(new MockServiceError(CATEGORY.TECHNICAL_ERROR, 503, `The mock run ${execution.ExternalExecutionID} is no longer available (the mock server was restarted).`), { testCase: updated });
    }
    if (cancel) {
        provider.cancel(execution.ExternalExecutionID);
    }
    const status = provider.getStatus(execution.ExternalExecutionID);
    const result = provider.getResult(execution.ExternalExecutionID);
    const documents = provider.getCreatedDocuments(execution.ExternalExecutionID);

    // steps
    const stepRows = await repo.find('ExecutionStep', { ExecutionUUID: execution.ExecutionUUID, IsActiveEntity: true });
    for (const step of status.steps) {
        const row = stepRows.find((r) => r.Sequence === step.sequence);
        if (row) {
            await repo.update('ExecutionStep', { StepUUID: row.StepUUID, IsActiveEntity: true }, {
                ExecutionStatus: step.status,
                Criticality: criticalityOf(step.status),
                ActualStatus: step.actualStatus,
                StartedAt: step.startedAt,
                FinishedAt: step.finishedAt,
                Message: step.message
            });
        }
    }
    // documents (only created ones; numbers are assigned when a step finishes)
    const docRows = await repo.find('DocumentReference', { ExecutionUUID: execution.ExecutionUUID, IsActiveEntity: true });
    for (const doc of documents) {
        const sequence = status.steps.find((s) => s.businessObjectType === doc.businessObjectType)?.sequence;
        const existing = docRows.find((r) => r.DocumentID === doc.documentId);
        const fields = {
            Sequence: sequence,
            BusinessObjectType: doc.businessObjectType,
            DocumentID: doc.documentId,
            DocumentItem: '',
            PredecessorDocumentID: doc.predecessorId,
            // successor documents (document flow), comma-separated: a service order can have a confirmation and a billing document request
            SuccessorDocumentID: documents
                .filter((other) => other.predecessorId === doc.documentId)
                .map((other) => other.documentId)
                .join(','),
            LifecycleStatus: doc.lifecycleStatus,
            NetAmount: doc.netAmount,
            TransactionCurrency: doc.currency,
            ExternalURL: '',
            ValidationStatus: ITEM_STATUS.SUCCESS,
            Criticality: criticalityOf(ITEM_STATUS.SUCCESS)
        };
        if (existing) {
            await repo.update('DocumentReference', { DocumentReferenceUUID: existing.DocumentReferenceUUID, IsActiveEntity: true }, fields);
        } else {
            await repo.add('DocumentReference', {
                DocumentReferenceUUID: uuid(),
                ExecutionUUID: execution.ExecutionUUID,
                TestCaseUUID: tc.TestCaseUUID,
                IsActiveEntity: true,
                HasActiveEntity: false,
                HasDraftEntity: false,
                DraftAdministrativeData: null,
                ...fields
            });
        }
    }

    const executionPatch = {
        Status: status.status,
        StatusCriticality: criticalityOf(status.status),
        ProgressPercent: status.progressPercent,
        TechnicalLog: result.log.join('\n')
    };
    const testCasePatch = {};
    const messages = [];
    if (status.status !== EXECUTION.RUNNING) {
        const data = await getData(repo, tc);
        const verification = verify({
            data,
            documents,
            readDocument: (type, id) => provider.readDocument(type, id),
            steps: status.steps,
            executionStatus: status.status,
            technicalResult: result.technicalResult
        });
        for (const assertion of verification.assertions) {
            await repo.add('TestAssertion', {
                AssertionUUID: uuid(),
                ExecutionUUID: execution.ExecutionUUID,
                TestCaseUUID: tc.TestCaseUUID,
                IsActiveEntity: true,
                HasActiveEntity: false,
                HasDraftEntity: false,
                DraftAdministrativeData: null,
                ...assertion
            });
        }
        const finishedAt = status.finishedAt || clock.nowIso();
        const duration = Math.max(0, Math.round((new Date(finishedAt) - new Date(status.startedAt)) / 1000));
        Object.assign(executionPatch, {
            FinishedAt: finishedAt,
            DurationInSeconds: duration,
            TechnicalResult: result.technicalResult,
            FunctionalResult: verification.finalResult,
            FunctionalResultCriticality: criticalityOf(verification.finalResult)
        });
        Object.assign(testCasePatch, {
            ExecutionStatus: status.status,
            FinalResult: verification.finalResult,
            ExecutionFinishedAt: finishedAt,
            ExecutionDuration: duration,
            ChangedAt: clock.nowIso()
        });
        const failed = verification.assertions.filter((a) => a.Result === 'FAILED').length;
        const text = `Execution ${execution.ExternalExecutionID} ${status.status.toLowerCase()}: final result ${verification.finalResult} (${documents.length} documents, ${verification.assertions.length} assertions, ${failed} failed).`;
        const severity =
            verification.finalResult === RESULT.PASSED ? SEVERITY.SUCCESS : verification.finalResult === RESULT.PASSED_WITH_WARNING ? SEVERITY.WARNING : SEVERITY.ERROR;
        messages.push(sapMessage(severity === SEVERITY.ERROR ? 403 : 907, text, { severity }));
        if (status.status === EXECUTION.FAILED) {
            const failedStep = status.steps.find((s) => s.status === STEP_STATUS.FAILED);
            messages.push(sapMessage(404, `EXECUTION_ERROR in step ${failedStep?.sequence}: ${failedStep?.message}`, { severity: SEVERITY.ERROR }));
        }
    }
    await repo.update('Execution', { ExecutionUUID: execution.ExecutionUUID, IsActiveEntity: true }, executionPatch);
    const updated = Object.keys(testCasePatch).length ? await repo.update('TestCase', tcKeys(tc), testCasePatch) : tc;
    return { testCase: updated, messages };
}

async function cancelExecution(repo, keys) {
    const tc = await getTestCase(repo, keys);
    if (tc.ExecutionStatus !== EXECUTION.RUNNING) {
        throw new MockServiceError(CATEGORY.EXECUTION_ERROR, 405, 'There is no running execution to cancel.');
    }
    return refreshExecution(repo, keys, { cancel: true });
}

async function applySuggestion(repo, validationKeys, selectedValue) {
    const row = await repo.findOne('ValidationResult', validationKeys);
    if (!row) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 205, 'Validation finding not found.');
    }
    const value = isEmpty(selectedValue) ? row.SuggestedValue : String(selectedValue).trim();
    if (isEmpty(value)) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 204, 'There is no suggestion for this finding. Enter the value in the form instead.');
    }
    const tc = await repo.findOne('TestCase', { TestCaseUUID: row.TestCaseUUID, IsActiveEntity: row.IsActiveEntity });
    if (row.FieldName === 'ProcessProfile') {
        await repo.update('TestCase', tcKeys(tc), { ProcessProfile: value });
    } else {
        const typed = NUMERIC_FIELDS.has(row.FieldName) ? Number(value) : value;
        await repo.update('TestCaseData', tcKeys(tc), { [row.FieldName]: typed });
        const data = await getData(repo, tc);
        const { pools } = await loadPools(repo);
        await determineTestData(repo, data, pools, [row.FieldName]);
    }
    const updatedRow = await repo.update('ValidationResult', validationKeys, {
        ResolvedValue: value,
        ValidationStatus: ITEM_STATUS.INFO,
        Criticality: criticalityOf(ITEM_STATUS.INFO),
        ValidationMessage: `Suggestion "${value}" applied to ${row.FieldName}. Run Validate again.`
    });
    const target = row.FieldName === 'ProcessProfile' ? 'ProcessProfile' : `_TestCaseData/${row.FieldName}`;
    await repo.update('TestCase', tcKeys(tc), {
        ValidationStatus: VALIDATION.NOT_VALIDATED,
        ApprovalStatus: tc.ApprovalStatus === APPROVAL.APPROVED ? APPROVAL.REVOKED : tc.ApprovalStatus,
        SAP__Messages: (tc.SAP__Messages || []).filter((m) => m.target !== target)
    });
    return { validationResult: updatedRow, messages: [sapMessage(908, `"${value}" applied. Run Validate to confirm the test data.`, { severity: SEVERITY.SUCCESS })] };
}

module.exports = {
    CURRENT_USER,
    DEFAULT_PROCESS_PROFILE,
    CONTROLLED_FIELDS,
    loadPools,
    deriveTestCase,
    deriveValidationResult,
    syncDerived,
    fieldControl,
    prepare,
    initialTestCase,
    createTestData,
    onTestDataChanged,
    onProcessProfileChanged,
    onActivated,
    validateTestCase,
    analyze,
    approve,
    startExecution,
    refreshExecution,
    cancelExecution,
    applySuggestion,
    getRequirements
};
