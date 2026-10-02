'use strict';
/**
 * TestCaseService — behavior of the facade BO "test case" in the mockup (stand-in for the RAP behavior
 * implementation of ZUI_STC_TEST_CASE_O4): determinations, validations, feature control and the actions
 * analyze · validate · approve · startExecution · refreshExecution · cancelExecution · revalidate · applySuggestion.
 *
 * Process reference: every test case belongs to a process team and a business process; its process variant (path)
 * and end object ("run up to") define the test steps and the execution plan. Saved changes create a new version;
 * an approval is valid for exactly one version. Approval and execution check the team roles server-side.
 *
 * All functions work on a repository (mock server entity interfaces or in-memory) and are free of mock server APIs,
 * so they are unit-testable and run unchanged in the browser-hosted variant.
 */
const { validate: runValidation, FIELD_BY_NAME, isEmpty } = require('../validation/ValidationEngine');
const { MockTestCaseExtractionService } = require('../extraction/MockTestCaseExtractionService');
const { processHints } = require('../extraction/processHints');
const { getProvider } = require('../execution/MockExecutionProvider');
const { verify } = require('../verification/VerificationService');
const numberRanges = require('../common/numberRanges');
const pricing = require('../common/pricing');
const clock = require('../common/clock');
const { VALIDATION, APPROVAL, EXECUTION, RESULT, LIFECYCLE, ITEM_STATUS, STEP_STATUS, ASSIGNMENT, TEAM_ROLE, RELEASE_STATUS, RUN_TYPE, TEST_LEVEL, BO, criticalityOf } = require('../common/codes');
const { CATEGORY, SEVERITY, sapMessage, MockServiceError } = require('../common/messages');
const catalog = require('../process/processCatalog');
const { assignmentOf } = require('../process/assignment');
const authorization = require('../process/authorization');
const { processModel } = require('./ProcessService');
const traceability = require('./TraceabilityService');

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
    'ServiceContract',
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
/** header fields of the process reference; a change re-derives the path, the test steps and the expectation */
const PROCESS_FIELDS = ['ProcessTeam', 'BusinessProcess', 'ProcessVariant', 'EndObject'];
/** content of a test case version (changes of these fields create a new version) */
const VERSIONED_FIELDS = [
    'ScenarioID',
    'Title',
    'Description',
    'ProcessProfile',
    'ProcessTeam',
    'BusinessProcess',
    'ProcessVariant',
    'EndObject',
    'TestLevel',
    'BusinessOwner',
    'Preconditions',
    'ExternalTestCaseID'
];

const extractionService = new MockTestCaseExtractionService();
const { newUUID: uuid } = require('../common/uuid');
const tcKeys = (tc) => ({ TestCaseUUID: tc.TestCaseUUID, IsActiveEntity: tc.IsActiveEntity });

/* ------------------------------------------------------------------------------------------------ */
/* Reading helpers                                                                                   */
/* ------------------------------------------------------------------------------------------------ */
async function loadPools(repo) {
    const [customers, contacts, functionalLocations, equipments, products, salesOrganizations, serviceOrganizations, serviceTeams, priorities, requestTypes, units, currencies, processProfiles, fields, serviceContracts] =
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
                'TestCaseFieldVH',
                'ServiceContractVH'
            ].map((set) => repo.find(set))
        );
    const fieldLabels = Object.fromEntries(fields.map((f) => [f.FieldName, f.FieldLabel]));
    return {
        pools: {
            customers,
            contacts,
            functionalLocations,
            equipments,
            products,
            salesOrganizations,
            serviceOrganizations,
            serviceTeams,
            priorities,
            requestTypes,
            units,
            currencies,
            processProfiles,
            serviceContracts
        },
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
/* Process reference: path of the process variant up to the end object                               */
/* ------------------------------------------------------------------------------------------------ */
async function knownTeams(repo) {
    return new Set((await repo.find('ProcessTeamVH')).map((t) => t.ProcessTeam));
}

/**
 * Path context of a test case: process model, assignment, design path, execution plan and the business objects of the
 * path (they decide which test data is required).
 *
 * @param {object} repo repository
 * @param {object} tc TestCase entry
 * @returns {Promise<object>} context
 */
async function pathContext(repo, tc) {
    const model = await processModel(repo, tc.BusinessProcess);
    const assignment = assignmentOf(tc, model, await knownTeams(repo));
    const usable = assignment.status !== ASSIGNMENT.OPEN && assignment.variant;
    const plan = usable ? catalog.executionPlan(model.steps, assignment.variant.Variant, tc.EndObject) : [];
    const chainTypes = usable ? [...new Set(plan.map((step) => step.businessObjectType))] : undefined;
    return {
        model,
        assignment,
        variant: assignment.variant,
        path: assignment.path,
        plan,
        chainTypes,
        needsContract: !!chainTypes && chainTypes.includes(BO.SERVICE_CONTRACT),
        billingPlan: !!chainTypes && chainTypes.includes(BO.SERVICE_CONTRACT) && !chainTypes.includes(BO.SERVICE_ORDER)
    };
}

/** Persists the derived process assignment of a test case version */
async function syncAssignment(repo, tc) {
    const { assignment, model } = await pathContext(repo, tc);
    const patch = {
        AssignmentStatus: assignment.status,
        AssignmentCriticality: criticalityOf(assignment.status),
        AssignmentNote: assignment.note.slice(0, 255)
    };
    if (model.process && tc.IsActiveEntity === false) {
        // the draft always refers to the current process version
        patch.ProcessVersion = model.process.ProcessVersion || 0;
    }
    await repo.update('TestCase', tcKeys(tc), patch);
}

/**
 * Process defaults for a new test case: the team of the user (process owner or test executor) with its pilot process,
 * the default variant of the process and its default end object.
 *
 * @param {object} repo repository
 * @param {string} user user
 * @returns {Promise<object>} defaults (empty when the user belongs to no team)
 */
async function processDefaults(repo, user) {
    const memberships = await repo.find('TeamMember', { UserID: user, IsActiveEntity: true });
    const teams = [...new Set(memberships.map((m) => m.ProcessTeam))].sort();
    const processes = await repo.find('BusinessProcess', { IsActiveEntity: true });
    for (const team of teams) {
        const process = processes.find((p) => p.OwnerTeam === team && p.PilotScope === catalog.PILOT);
        if (process) {
            return { ProcessTeam: team, BusinessProcess: process.ProcessID };
        }
    }
    return teams.length ? { ProcessTeam: teams[0] } : {};
}

/** Business owner: the user when process owner of the team, otherwise the first process owner of the team */
async function defaultBusinessOwner(repo, team, user) {
    const owners = (await repo.find('TeamMember', { ProcessTeam: team, TeamRole: TEAM_ROLE.PROCESS_OWNER, IsActiveEntity: true })).map((m) => m.UserID).sort();
    return owners.includes(user) ? user : owners[0] || '';
}

/**
 * Re-derives the generated test steps (source DERIVED) of a test case from its path; manually added steps are kept.
 *
 * @param {object} repo repository
 * @param {object} tc TestCase entry
 * @param {object} context path context
 * @returns {Promise<number>} number of generated steps
 */
async function regenerateSteps(repo, tc, context) {
    const existing = await repo.find('TestCaseStep', tcKeys(tc));
    const manual = existing.filter((row) => row.StepSource !== 'DERIVED').sort((a, b) => a.StepNo - b.StepNo);
    for (const row of existing.filter((r) => r.StepSource === 'DERIVED')) {
        await repo.remove('TestCaseStep', { TestCaseStepUUID: row.TestCaseStepUUID, IsActiveEntity: row.IsActiveEntity });
    }
    const generated =
        context.variant && context.assignment.status !== ASSIGNMENT.OPEN ? catalog.designSteps(context.model.steps, context.variant.Variant, tc.EndObject) : [];
    for (const step of generated) {
        await repo.add('TestCaseStep', {
            TestCaseStepUUID: uuid(),
            TestCaseUUID: tc.TestCaseUUID,
            IsActiveEntity: tc.IsActiveEntity,
            HasActiveEntity: false,
            HasDraftEntity: false,
            DraftAdministrativeData: null,
            ...step,
            TeamAssignmentCriticality: criticalityOf(step.TeamAssignment),
            StepSource: 'DERIVED'
        });
    }
    let stepNo = generated.length * 10;
    for (const row of manual) {
        stepNo += 10;
        await repo.update('TestCaseStep', { TestCaseStepUUID: row.TestCaseStepUUID, IsActiveEntity: row.IsActiveEntity }, { StepNo: stepNo });
    }
    return generated.length;
}

/**
 * Determination of the process reference (create and change of team, process, variant or end object):
 * consistent defaults, test steps of the path, current process version, test level.
 *
 * @param {object} repo repository
 * @param {object} keys TestCase keys (draft)
 * @param {string[]} changed changed header fields (empty on create)
 * @param {string} [user] user
 * @returns {Promise<object>} applied patch
 */
async function determineProcessReference(repo, keys, changed, user = CURRENT_USER) {
    let tc = await getTestCase(repo, keys);
    const patch = {};
    if (!changed.length && !tc.ProcessTeam && !tc.BusinessProcess) {
        Object.assign(patch, await processDefaults(repo, user));
    }
    const team = patch.ProcessTeam ?? tc.ProcessTeam;
    let processId = patch.BusinessProcess ?? tc.BusinessProcess;
    if (changed.includes('ProcessTeam') && team && !processId) {
        const processes = await repo.find('BusinessProcess', { IsActiveEntity: true });
        processId = processes.find((p) => p.OwnerTeam === team && p.PilotScope === catalog.PILOT)?.ProcessID || '';
        patch.BusinessProcess = processId;
    }
    const model = await processModel(repo, processId);
    let variant = patch.ProcessVariant ?? tc.ProcessVariant;
    if (model.process && !model.variants.some((v) => v.Variant === variant)) {
        variant = model.variants.find((v) => v.IsDefault)?.Variant || '';
        patch.ProcessVariant = variant;
    } else if (!model.process && processId === '' && variant) {
        patch.ProcessVariant = '';
        variant = '';
    }
    if (variant && model.process) {
        const possible = catalog.possibleEndObjects(model.steps, variant);
        const endObject = patch.EndObject ?? tc.EndObject;
        if (!possible.includes(endObject)) {
            patch.EndObject = catalog.defaultEndObject(model.steps, variant) || '';
        }
    }
    if (team && (!tc.BusinessOwner || changed.includes('ProcessTeam'))) {
        const owner = await defaultBusinessOwner(repo, team, user);
        const owners = (await repo.find('TeamMember', { ProcessTeam: team, TeamRole: TEAM_ROLE.PROCESS_OWNER, IsActiveEntity: true })).map((m) => m.UserID);
        if (!tc.BusinessOwner || !owners.includes(tc.BusinessOwner)) {
            patch.BusinessOwner = owner;
        }
    }
    if (model.process) {
        patch.ProcessVersion = model.process.ProcessVersion || 0;
    }
    if (Object.keys(patch).length) {
        tc = await repo.update('TestCase', tcKeys(tc), patch);
    }
    const context = await pathContext(repo, tc);
    // test level: across teams when the path hands over to another team, otherwise the team's own sub-process
    const levelPatch = {
        TestLevel: context.path.some((step) => step.ResponsibleTeam && step.ResponsibleTeam !== tc.ProcessTeam) ? TEST_LEVEL.E2E : TEST_LEVEL.SUB_PROCESS
    };
    if (changed.length || !(await repo.find('TestCaseStep', tcKeys(tc))).length) {
        await regenerateSteps(repo, tc, context);
    }
    if (Object.keys(levelPatch).length) {
        tc = await repo.update('TestCase', tcKeys(tc), levelPatch);
    }
    await syncAssignment(repo, tc);
    return { ...patch, ...levelPatch };
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
        await syncAssignment(repo, tc);
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
        // process reference: defaults from the team of the user (determination after create)
        ProcessTeam: tc.ProcessTeam || '',
        BusinessProcess: tc.BusinessProcess || '',
        ProcessVariant: tc.ProcessVariant || '',
        EndObject: tc.EndObject || '',
        TestLevel: tc.TestLevel || '',
        BusinessOwner: tc.BusinessOwner || '',
        Preconditions: tc.Preconditions || '',
        ExternalTestCaseID: tc.ExternalTestCaseID || '',
        ProcessVersion: 0,
        AssignmentStatus: ASSIGNMENT.OPEN,
        AssignmentCriticality: criticalityOf(ASSIGNMENT.OPEN),
        AssignmentNote: '',
        Version: 0,
        ApprovedVersion: 0,
        ContentHash: '',
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
 * - The reference product is derived from the equipment (source DERIVED): it is set when empty and re-derived whenever
 *   the equipment changes; a reference product the user maintains afterwards is kept and checked by rule R5.
 * - Functional location and customer follow the equipment when empty; the service organization follows the service team when empty.
 * - The expected net value is proposed from the mock price list when empty (stand-in for a pricing simulation, SIM-3);
 *   a value the user maintains is kept. Clearing it recalculates it.
 *
 * @param {object} repo repository
 * @param {object} data TestCaseData entry
 * @param {object} pools value help pools
 * @param {string[]} [changedFields] fields changed by the triggering modification
 * @returns {Promise<object>} applied patch
 */
async function determineTestData(repo, data, pools, changedFields = [], context = {}) {
    const patch = {};
    const equipment = pools.equipments.find((e) => e.Equipment === data.ServiceReferenceEquipment);
    if (equipment && (isEmpty(data.ReferenceProduct) || changedFields.includes('ServiceReferenceEquipment')) && data.ReferenceProduct !== equipment.Material) {
        patch.ReferenceProduct = equipment.Material;
    }
    if (equipment && isEmpty(data.ServiceRefFunctionalLocation)) {
        patch.ServiceRefFunctionalLocation = equipment.FunctionalLocation;
    }
    const location = pools.functionalLocations.find((f) => f.FunctionalLocation === (patch.ServiceRefFunctionalLocation || data.ServiceRefFunctionalLocation));
    const owner = equipment?.Customer || location?.Customer;
    if (owner && isEmpty(data.SoldToParty)) {
        patch.SoldToParty = owner;
    }
    const team = pools.serviceTeams.find((t) => t.RespyMgmtServiceTeam === data.RespyMgmtServiceTeam);
    if (team?.ServiceOrganization && isEmpty(data.ServiceOrganization)) {
        patch.ServiceOrganization = team.ServiceOrganization;
    }
    // contract determination (variant "service from a contract"): released, valid contract covering the reference object
    if (context.needsContract && isEmpty(data.ServiceContract)) {
        const contract = determineContract(pools, { ...data, ...patch });
        if (contract) {
            patch.ServiceContract = contract.ServiceContract;
        }
    }
    const contract = pools.serviceContracts?.find((c) => c.ServiceContract === (patch.ServiceContract || data.ServiceContract));
    if (contract && isEmpty(data.SoldToParty) && !patch.SoldToParty) {
        patch.SoldToParty = contract.SoldToParty;
    }
    if (isEmpty(data.ExpectedNetAmount)) {
        // billing plan of a contract: the contract amount; otherwise the mock price list (SIM-3)
        const expected = context.billingPlan ? (contract ? Number(contract.BillingPlanNetAmount) : undefined) : pricing.expectedNetAmount({ ...data, ...patch });
        if (expected !== undefined) {
            patch.ExpectedNetAmount = expected;
        }
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

/** Functional location of the reference object and its superior functional locations (object list of a contract) */
function referenceLocations(pools, data) {
    const equipment = pools.equipments.find((e) => e.Equipment === data.ServiceReferenceEquipment);
    const locations = [];
    let current = data.ServiceRefFunctionalLocation || equipment?.FunctionalLocation;
    while (current && !locations.includes(current)) {
        locations.push(current);
        current = pools.functionalLocations.find((f) => f.FunctionalLocation === current)?.SuperiorFunctionalLocation;
    }
    return locations;
}

/** Contract determination of the mock: a released contract of the customer, valid today, covering the reference object */
function determineContract(pools, data) {
    const today = clock.nowIso().slice(0, 10);
    const locations = referenceLocations(pools, data);
    return (pools.serviceContracts || []).find(
        (c) =>
            c.ServiceContractIsReleased &&
            (!c.ServiceContractStartDate || today >= c.ServiceContractStartDate) &&
            (!c.ServiceContractEndDate || today <= c.ServiceContractEndDate) &&
            (!data.SoldToParty || c.SoldToParty === data.SoldToParty) &&
            locations.includes(c.ServiceRefFunctionalLocation)
    );
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
    const tc = await repo.findOne('TestCase', dataKeys);
    await determineTestData(repo, data, pools, changedFields, tc ? await pathContext(repo, tc) : {});
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

/**
 * Called after team, process, variant or end object of a draft changed: consistent process reference, new test steps,
 * re-derived expectation (the path decides which documents are priced) and a new validation.
 *
 * @param {object} repo repository
 * @param {object} keys draft keys
 * @param {string[]} changed changed fields
 * @returns {Promise<object>} applied patch
 */
async function onProcessReferenceChanged(repo, keys, changed) {
    const patch = await determineProcessReference(repo, keys, changed);
    const tc = await getTestCase(repo, keys);
    const data = await getData(repo, tc);
    if (data.TestCaseUUID) {
        const context = await pathContext(repo, tc);
        const { pools } = await loadPools(repo);
        // the expectation depends on the path (contract billing plan or price list): propose it again
        const reset = { ExpectedNetAmount: null };
        if (!context.needsContract && !isEmpty(data.ServiceContract)) {
            reset.ServiceContract = null;
        }
        await repo.update('TestCaseData', tcKeys(tc), reset);
        await determineTestData(repo, { ...data, ...reset }, pools, Object.keys(reset), context);
    }
    await repo.update('TestCase', tcKeys(tc), {
        ValidationStatus: VALIDATION.NOT_VALIDATED,
        ApprovalStatus: tc.ApprovalStatus === APPROVAL.APPROVED ? APPROVAL.REVOKED : tc.ApprovalStatus,
        SAP__Messages: [],
        ChangedAt: clock.nowIso()
    });
    return patch;
}

/** Content of a version: header fields, test data and test steps */
async function versionSnapshot(repo, tc) {
    const data = await getData(repo, tc);
    const steps = (await repo.find('TestCaseStep', tcKeys(tc))).sort((a, b) => a.StepNo - b.StepNo);
    return {
        header: Object.fromEntries(VERSIONED_FIELDS.map((f) => [f, tc[f] ?? ''])),
        data: Object.fromEntries(CONTROLLED_FIELDS.map((f) => [f, data[f] === null || data[f] === undefined ? '' : String(data[f])])),
        steps: steps.map((st) => ({ StepNo: st.StepNo, ProcessStepID: st.ProcessStepID || '', Action: st.Action || '', ExpectedResult: st.ExpectedResult || '' }))
    };
}

function changeSummary(previous, current) {
    if (!previous) {
        return 'Initial version';
    }
    const changed = [];
    for (const part of ['header', 'data']) {
        for (const key of Object.keys(current[part])) {
            if (String(previous[part]?.[key] ?? '') !== String(current[part][key] ?? '')) {
                changed.push(key);
            }
        }
    }
    if (catalog.stableStringify(previous.steps) !== catalog.stableStringify(current.steps)) {
        changed.push('Test steps');
    }
    return changed.length ? `Changed: ${changed.join(', ')}` : 'No content change';
}

/**
 * RAP: late numbering on activation — assigns the Case ID. Versioning: a changed content creates a new version
 * (history row); an approval of the previous version is revoked (re-approval required).
 *
 * @param {object} repo repository
 * @param {object} keys TestCase keys
 * @param {string} [user] user
 * @returns {Promise<{testCase: object, messages: object[]}|undefined>} result
 */
async function onActivated(repo, keys, user = CURRENT_USER) {
    const tc = await repo.findOne('TestCase', { TestCaseUUID: keys.TestCaseUUID, IsActiveEntity: true });
    if (!tc) {
        return undefined;
    }
    const patch = { SAP__Messages: [], ChangedAt: clock.nowIso() };
    if (isEmpty(tc.CaseID)) {
        patch.CaseID = numberRanges.nextCaseId(repo.tenantId);
    }
    const messages = [];
    const snapshot = await versionSnapshot(repo, tc);
    const hash = catalog.contentHash(snapshot);
    if (hash !== tc.ContentHash || !tc.Version) {
        const version = (Number(tc.Version) || 0) + 1;
        const history = await repo.find('TestCaseVersion', { TestCaseUUID: tc.TestCaseUUID });
        const previous = history.sort((a, b) => b.Version - a.Version)[0];
        const approvalRevoked = tc.ApprovalStatus === APPROVAL.APPROVED || (tc.ApprovalStatus === APPROVAL.REVOKED && Number(tc.ApprovedVersion) > 0);
        Object.assign(patch, { Version: version, ContentHash: hash });
        if (approvalRevoked) {
            patch.ApprovalStatus = APPROVAL.REVOKED;
            messages.push(
                sapMessage(
                    108,
                    `The approved test case was changed: version ${version} needs a new approval (approved version ${tc.ApprovedVersion || version - 1}).`,
                    { severity: SEVERITY.WARNING }
                )
            );
        }
        const model = await processModel(repo, tc.BusinessProcess);
        await repo.add('TestCaseVersion', {
            TestCaseVersionUUID: uuid(),
            TestCaseUUID: tc.TestCaseUUID,
            CaseID: patch.CaseID || tc.CaseID,
            Version: version,
            ActivatedAt: clock.nowIso(),
            ActivatedBy: user,
            ChangeSummary: changeSummary(previous && previous.Snapshot ? JSON.parse(previous.Snapshot) : undefined, snapshot).slice(0, 255),
            ProcessID: tc.BusinessProcess || '',
            ProcessVersion: model.process?.ProcessVersion || 0,
            ProcessVariant: tc.ProcessVariant || '',
            ApprovalStatus: APPROVAL.NOT_APPROVED,
            ApprovalCriticality: criticalityOf(APPROVAL.NOT_APPROVED),
            ApprovedBy: '',
            ApprovedAt: null,
            ContentHash: hash,
            Snapshot: JSON.stringify(snapshot)
        });
        if (model.process) {
            patch.ProcessVersion = model.process.ProcessVersion || 0;
        }
    }
    const updated = await repo.update('TestCase', tcKeys(tc), patch);
    return { testCase: updated, messages };
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
    // required fields follow the business objects of the path; a contract variant requires the service contract
    const context = await pathContext(repo, tc);
    const result = runValidation({
        testCase: tc,
        data,
        requirements,
        pools,
        extraction,
        fieldLabels,
        chainTypes: context.chainTypes,
        requiredByVariant: context.needsContract ? ['ServiceContract'] : [],
        referenceDate: clock.nowIso().slice(0, 10)
    });
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
/**
 * Process hints of the description (way, end object, team): applied before the test data, because the path decides
 * which documents are expected and how the expected value is proposed.
 *
 * @returns {Promise<string[]>} applied hints (texts for the message)
 */
async function applyProcessHints(repo, tc) {
    const hints = processHints(tc.NaturalLanguageInput, { meteringFault: /^MD_/.test(tc.ProcessProfile || '') });
    const patch = {};
    if (hints.team && hints.team !== tc.ProcessTeam && (await knownTeams(repo)).has(hints.team)) {
        patch.ProcessTeam = hints.team;
    }
    const model = await processModel(repo, tc.BusinessProcess);
    if (hints.variant && hints.variant !== tc.ProcessVariant && model.variants.some((v) => v.Variant === hints.variant)) {
        patch.ProcessVariant = hints.variant;
    }
    if (hints.endObject && hints.endObject !== tc.EndObject) {
        patch.EndObject = hints.endObject;
    }
    if (!Object.keys(patch).length) {
        return [];
    }
    await repo.update('TestCase', tcKeys(tc), patch);
    await determineProcessReference(repo, tcKeys(tc), Object.keys(patch));
    const applied = await getTestCase(repo, tcKeys(tc));
    return [
        applied.ProcessTeam !== tc.ProcessTeam ? `team ${applied.ProcessTeam}` : '',
        applied.ProcessVariant !== tc.ProcessVariant ? `variant ${applied.ProcessVariant}` : '',
        applied.EndObject !== tc.EndObject ? `run up to ${applied.EndObject}` : ''
    ].filter(Boolean);
}

async function analyze(repo, keys) {
    let tc = await getTestCase(repo, keys);
    if (isEmpty(tc.NaturalLanguageInput)) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 201, 'Describe the test scenario first, then run Analyze.', 'NaturalLanguageInput');
    }
    const processApplied = await applyProcessHints(repo, tc);
    tc = await getTestCase(repo, keys);
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
        await determineTestData(repo, { ...data, ...patch }, pools, Object.keys(patch), await pathContext(repo, tc));
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
    const processText = processApplied.length ? ` Process reference from the description: ${processApplied.join(', ')}.` : '';
    const text =
        proposals.length === 0
            ? `Analyze (mock keyword matching) found no known master data in the description.${processText}`
            : `Analyze (mock keyword matching) filled ${filled} fields${kept ? `, kept ${kept} of your values` : ''}${ambiguousCount ? `, ${ambiguousCount} ambiguous` : ''}.${processText} Run Validate to check the test data.`;
    return { testCase: updated, messages: [sapMessage(ambiguousCount ? 106 : 904, text, { severity: ambiguousCount ? SEVERITY.WARNING : SEVERITY.SUCCESS })] };
}

/**
 * Approve (human in the loop): valid test data, assigned process reference, business responsibility of the user
 * (role PROCESS_OWNER in the team of the test case) and — per process profile — the four-eyes principle.
 * The approval is valid for the current version only.
 */
async function approve(repo, keys, user = CURRENT_USER) {
    const tc = await getTestCase(repo, keys);
    if (tc.ValidationStatus !== VALIDATION.VALID) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 203, 'Only valid test cases can be approved. Run Validate and resolve all findings first.');
    }
    if (tc.ExecutionStatus === EXECUTION.RUNNING) {
        throw new MockServiceError(CATEGORY.EXECUTION_ERROR, 402, 'The test case cannot be approved while an execution is running.');
    }
    const { assignment } = await pathContext(repo, tc);
    if (assignment.status === ASSIGNMENT.OPEN) {
        throw new MockServiceError(CATEGORY.BUSINESS_ERROR, 207, `The process assignment is open and has to be completed before approval: ${assignment.note}`, 'ProcessTeam');
    }
    await authorization.requireRole(repo, { user, team: tc.ProcessTeam, role: TEAM_ROLE.PROCESS_OWNER, action: 'approve this test case', number: 303 });
    const profile = await getProfile(repo, tc.ProcessProfile);
    if (profile && profile.RequiresSecondApprover && tc.CreatedBy === user) {
        throw new MockServiceError(
            CATEGORY.AUTHORIZATION_ERROR,
            301,
            `Four-eyes principle (process profile ${tc.ProcessProfile}): ${user} created this test case and cannot approve it. A second person has to approve it.`
        );
    }
    const now = clock.nowIso();
    const version = Number(tc.Version) || 1;
    const updated = await repo.update('TestCase', tcKeys(tc), { ApprovalStatus: APPROVAL.APPROVED, ApprovedBy: user, ApprovedAt: now, ApprovedVersion: version, ChangedAt: now });
    const versionRow = (await repo.find('TestCaseVersion', { TestCaseUUID: tc.TestCaseUUID, Version: version }))[0];
    if (versionRow) {
        await repo.update(
            'TestCaseVersion',
            { TestCaseVersionUUID: versionRow.TestCaseVersionUUID },
            { ApprovalStatus: APPROVAL.APPROVED, ApprovalCriticality: criticalityOf(APPROVAL.APPROVED), ApprovedBy: user, ApprovedAt: now }
        );
    }
    return {
        testCase: updated,
        messages: [sapMessage(905, `Test case version ${version} approved. You can start the execution now.`, { severity: SEVERITY.SUCCESS })]
    };
}

/**
 * The release a run belongs to: the given release, otherwise the release in test whose scope contains team and process.
 *
 * @param {object} repo repository
 * @param {object} tc TestCase entry
 * @param {string} [releaseId] explicit release (regression run)
 * @returns {Promise<{release?: object, scope?: object}>} release and scope entry
 */
async function releaseFor(repo, tc, releaseId) {
    const scopes = await repo.find('ReleaseScope', { ProcessTeam: tc.ProcessTeam, ProcessID: tc.BusinessProcess, IsActiveEntity: true });
    const releases = await repo.find('Release', { IsActiveEntity: true });
    if (releaseId) {
        return { release: releases.find((r) => r.ReleaseID === releaseId), scope: scopes.find((sc) => sc.ReleaseID === releaseId) };
    }
    const candidates = releases
        .filter((r) => r.ReleaseStatus === RELEASE_STATUS.IN_TEST && scopes.some((sc) => sc.ReleaseID === r.ReleaseID))
        .sort((a, b) => String(a.TestEndDate || '9999').localeCompare(String(b.TestEndDate || '9999')));
    const release = candidates[0];
    return { release, scope: release ? scopes.find((sc) => sc.ReleaseID === release.ReleaseID) : undefined };
}

/**
 * Server-side checks before every execution (single run and regression run).
 *
 * @param {object} repo repository
 * @param {object} tc TestCase entry (active)
 * @param {object} [options] options
 * @param {string} [options.user] user
 * @param {string} [options.releaseId] release of a regression run
 * @returns {Promise<{ok: boolean, error?: MockServiceError, context?: object, release?: object, scope?: object}>} result
 */
async function executionCheck(repo, tc, { user = CURRENT_USER, releaseId } = {}) {
    const fail = (category, number, text, target) => ({ ok: false, error: new MockServiceError(category, number, text, target) });
    if (tc.ExecutionStatus === EXECUTION.RUNNING) {
        return fail(CATEGORY.EXECUTION_ERROR, 401, `Execution ${tc.ExternalExecutionID} is still running for this test case.`);
    }
    if (tc.ApprovalStatus !== APPROVAL.APPROVED) {
        return fail(CATEGORY.BUSINESS_ERROR, 202, 'Approve the test case before starting the execution.');
    }
    if (Number(tc.ApprovedVersion) !== Number(tc.Version)) {
        return fail(CATEGORY.BUSINESS_ERROR, 206, `Version ${tc.Version} is not approved (approved version ${tc.ApprovedVersion}): changes need a new approval.`);
    }
    const context = await pathContext(repo, tc);
    if (context.assignment.status === ASSIGNMENT.OPEN) {
        return fail(CATEGORY.BUSINESS_ERROR, 207, `The process assignment is open: ${context.assignment.note}`);
    }
    if (!(await authorization.hasRole(repo, user, tc.ProcessTeam, TEAM_ROLE.TEST_EXECUTOR))) {
        return fail(
            CATEGORY.AUTHORIZATION_ERROR,
            302,
            `${user} may not run this test case: the role ${authorization.ROLE_TEXT[TEAM_ROLE.TEST_EXECUTOR]} in process team ${tc.ProcessTeam} is missing. Roles are maintained in the process team.`
        );
    }
    if (!context.plan.length) {
        return fail(CATEGORY.BUSINESS_ERROR, 210, `Variant ${tc.ProcessVariant} up to ${tc.EndObject || 'its end'} has no automated step.`);
    }
    const { release, scope } = await releaseFor(repo, tc, releaseId);
    if (releaseId && (!release || !scope)) {
        return fail(CATEGORY.BUSINESS_ERROR, 209, `Team ${tc.ProcessTeam} with process ${tc.BusinessProcess} is not in the scope of release ${releaseId}.`);
    }
    return { ok: true, context, release, scope };
}

/**
 * Start Execution: server-side checks (approval of the current version, process assignment, execution authorization,
 * release scope), then the execution plan of the path is handed over to the execution provider.
 *
 * @param {object} repo repository
 * @param {object} keys TestCase keys (active)
 * @param {object} [options] options
 * @param {string} [options.user] user
 * @param {string} [options.releaseId] release of a regression run (single run: the release in test of team and process)
 * @param {string} [options.runType] SINGLE | REGRESSION
 * @param {string} [options.regressionRunUUID] regression run
 * @returns {Promise<{testCase: object, messages: object[], executionUUID: string}>} result
 */
async function startExecution(repo, keys, { user = CURRENT_USER, releaseId, runType = RUN_TYPE.SINGLE, regressionRunUUID = null } = {}) {
    const tc = await getTestCase(repo, keys);
    const check = await executionCheck(repo, tc, { user, releaseId });
    if (!check.ok) {
        throw check.error;
    }
    const { context, release } = check;
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
    // hand over the validated data set only (no technical draft fields), the plan of the path and the reference objects
    const dataset = Object.fromEntries([...CONTROLLED_FIELDS, 'SalesOrganizationOrgUnitID'].filter((f) => !isEmpty(data[f])).map((f) => [f, data[f]]));
    const { pools } = await loadPools(repo);
    let externalExecutionId;
    try {
        ({ externalExecutionId } = provider.start(
            {
                data: dataset,
                processProfile: tc.ProcessProfile,
                variant: tc.ProcessVariant,
                plan: context.plan,
                serviceContract: pools.serviceContracts.find((c) => c.ServiceContract === data.ServiceContract),
                referenceLocations: referenceLocations(pools, data)
            },
            { caseId: tc.CaseID, soldToParty: data.SoldToParty }
        ));
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
        TechnicalLog: provider.getResult(externalExecutionId).log.join('\n'),
        ReleaseID: release?.ReleaseID || '',
        TestCaseVersion: Number(tc.Version) || 0,
        ProcessID: tc.BusinessProcess || '',
        ProcessVersion: context.model.process?.ProcessVersion || 0,
        ProcessVariant: tc.ProcessVariant || '',
        EndObject: tc.EndObject || '',
        RunType: runType,
        RegressionRunUUID: regressionRunUUID,
        ExecutedBy: user
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
            Message: '',
            ProcessStepID: step.processStepID || '',
            StepName: step.stepName || '',
            ResponsibleTeam: step.responsibleTeam || ''
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
    const releaseText = release ? ` for release ${release.ReleaseID}` : ' (no release in test for this team and process)';
    return {
        testCase: updated,
        executionUUID,
        messages: [
            sapMessage(
                906,
                `Execution ${externalExecutionId} of version ${tc.Version} started${releaseText} via MockExecutionProvider (simulation, no SAP test automation). The status refreshes automatically.`,
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
        const creatingStep = status.steps.find((st) => st.processStepID && st.processStepID === doc.processStepID) || status.steps.find((st) => st.businessObjectType === doc.businessObjectType);
        const fields = {
            Sequence: sequence,
            BusinessObjectType: doc.businessObjectType,
            DocumentID: doc.documentId,
            DocumentItem: '',
            ProcessStepID: creatingStep?.processStepID || '',
            StepName: creatingStep?.stepName || '',
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
    if (status.status !== EXECUTION.RUNNING) {
        // results per release, team, process and process step
        await traceability.refreshAll(repo);
    }
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
        await determineTestData(repo, data, pools, [row.FieldName], await pathContext(repo, tc));
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
    PROCESS_FIELDS,
    pathContext,
    determineProcessReference,
    onProcessReferenceChanged,
    executionCheck,
    releaseFor,
    referenceLocations,
    determineTestData,
    regenerateSteps,
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
