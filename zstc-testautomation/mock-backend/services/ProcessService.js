'use strict';
/**
 * ProcessService — behavior of the configuration BOs "process team" (with members and roles) and "business process"
 * (with process steps and process variants, versioned):
 *   - initial values and determinations of new rows (draft),
 *   - validations on save (Prepare),
 *   - versioning on activation: every saved change of the process model creates a new process version (history row),
 *   - derived fields (handover flags, step and document paths, counts) and the read-only value helps.
 *
 * The value help sets (ProcessTeamVH, TeamMemberVH, BusinessProcessVH, ProcessVariantVH, ProcessStepVH) are the read
 * models of the active instances — on the real system CDS views on the same tables.
 */
const catalog = require('../process/processCatalog');
const { isEmpty } = require('../validation/ValidationEngine');
const { ASSIGNMENT, TEAM_ROLE, criticalityOf } = require('../common/codes');
const { CATEGORY, MockServiceError } = require('../common/messages');
const clock = require('../common/clock');
const { newUUID: uuid } = require('../common/uuid');

const KNOWN_BOS = new Set(catalog.DOCUMENT_ORDER);
const PILOT_SCOPES = new Set(['PILOT', 'LATER']);
const AUTOMATIONS = new Set(Object.values(catalog.AUTOMATION));

/* ------------------------------------------------------------------------------------------------ */
/* Reading                                                                                           */
/* ------------------------------------------------------------------------------------------------ */
/**
 * Active process model: process, steps and variants.
 *
 * @param {object} repo repository
 * @param {string} processId process ID
 * @returns {Promise<{process: object|undefined, steps: object[], variants: object[]}>} model
 */
async function processModel(repo, processId) {
    if (!processId) {
        return { process: undefined, steps: [], variants: [] };
    }
    const [process, steps, variants] = await Promise.all([
        repo.findOne('BusinessProcess', { ProcessID: processId, IsActiveEntity: true }),
        repo.find('ProcessStep', { ProcessID: processId, IsActiveEntity: true }),
        repo.find('ProcessVariant', { ProcessID: processId, IsActiveEntity: true })
    ]);
    return { process, steps, variants };
}

/* ------------------------------------------------------------------------------------------------ */
/* Process team                                                                                      */
/* ------------------------------------------------------------------------------------------------ */
function initialProcessTeam(team) {
    return {
        ProcessTeamName: team.ProcessTeamName || '',
        ProcessArea: team.ProcessArea || '',
        IsActive: team.IsActive ?? true,
        ProcessOwnerCount: 0,
        TestExecutorCount: 0,
        ResponsibleStepCount: 0,
        TestCaseCount: 0,
        OpenAssignmentCount: 0,
        SAP__Messages: [],
        __EntityControl: { Updatable: true, Deletable: false }
    };
}

function initialTeamMember(row) {
    return { TeamRole: row.TeamRole || TEAM_ROLE.TEST_EXECUTOR, Note: row.Note || '' };
}

/**
 * Validation on save (Prepare) of a process team draft: name, known users, roles, at least one process owner.
 *
 * @param {object} repo repository
 * @param {string} teamId process team
 */
async function validateProcessTeam(repo, teamId) {
    const team = await repo.findOne('ProcessTeam', { ProcessTeam: teamId, IsActiveEntity: false });
    if (!team) {
        return;
    }
    if (isEmpty(team.ProcessTeamName)) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 120, 'Enter a name for the process team.', 'ProcessTeamName');
    }
    const members = await repo.find('TeamMember', { ProcessTeam: teamId, IsActiveEntity: false });
    const users = new Set((await repo.find('UserVH')).map((u) => u.UserID));
    const seen = new Set();
    for (const member of members) {
        if (isEmpty(member.UserID) || !users.has(member.UserID)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 121, `Team member "${member.UserID || ''}" is not a known user.`);
        }
        if (!Object.values(TEAM_ROLE).includes(member.TeamRole)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 122, `Select a role for team member ${member.UserID}.`);
        }
        const key = `${member.UserID}|${member.TeamRole}`;
        if (seen.has(key)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 123, `${member.UserID} has the role ${member.TeamRole} more than once.`);
        }
        seen.add(key);
    }
    if (team.IsActive !== false && !members.some((m) => m.TeamRole === TEAM_ROLE.PROCESS_OWNER)) {
        throw new MockServiceError(
            CATEGORY.VALIDATION_ERROR,
            124,
            'An active process team needs at least one process owner (business responsibility): nobody could approve its test cases.'
        );
    }
}

/** Read models of a team: ProcessTeamVH and TeamMemberVH (active instances only) */
async function syncTeamValueHelps(repo, teamId) {
    const team = await repo.findOne('ProcessTeam', { ProcessTeam: teamId, IsActiveEntity: true });
    const vh = await repo.findOne('ProcessTeamVH', { ProcessTeam: teamId });
    if (team && team.IsActive !== false) {
        const row = { ProcessTeam: teamId, ProcessTeamName: team.ProcessTeamName, ProcessArea: team.ProcessArea || '' };
        if (vh) {
            await repo.update('ProcessTeamVH', { ProcessTeam: teamId }, row);
        } else {
            await repo.add('ProcessTeamVH', row);
        }
    } else if (vh) {
        await repo.remove('ProcessTeamVH', { ProcessTeam: teamId });
    }
    for (const row of await repo.find('TeamMemberVH', { ProcessTeam: teamId })) {
        await repo.remove('TeamMemberVH', { ProcessTeam: row.ProcessTeam, UserID: row.UserID, TeamRole: row.TeamRole });
    }
    if (team && team.IsActive !== false) {
        const users = new Map((await repo.find('UserVH')).map((u) => [u.UserID, u.UserName]));
        for (const member of await repo.find('TeamMember', { ProcessTeam: teamId, IsActiveEntity: true })) {
            await repo.add('TeamMemberVH', { ProcessTeam: teamId, UserID: member.UserID, UserName: users.get(member.UserID) || member.UserID, TeamRole: member.TeamRole });
        }
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* Business process                                                                                  */
/* ------------------------------------------------------------------------------------------------ */
function initialBusinessProcess(process) {
    return {
        ProcessName: process.ProcessName || '',
        PilotScope: process.PilotScope || 'LATER',
        ProcessVersion: 0,
        VersionNote: '',
        ModelingStatus: ASSIGNMENT.OPEN,
        ModelingCriticality: criticalityOf(ASSIGNMENT.OPEN),
        StepCount: 0,
        VariantCount: 0,
        TestCaseCount: 0,
        ContentHash: '',
        SAP__Messages: [],
        __EntityControl: { Updatable: true, Deletable: false }
    };
}

async function nextSequence(repo, set, processId) {
    const rows = await repo.find(set, { ProcessID: processId, IsActiveEntity: false });
    return rows.reduce((max, r) => Math.max(max, Number(r.Sequence) || 0), 0) + 10;
}

async function initialProcessStep(repo, row) {
    const sequence = row.Sequence || (await nextSequence(repo, 'ProcessStep', row.ProcessID));
    return {
        Sequence: sequence,
        StepID: row.StepID || `${row.ProcessID}-${String(sequence).padStart(3, '0')}`,
        StepName: row.StepName || '',
        BusinessObjectType: row.BusinessObjectType || '',
        ExpectedStatus: row.ExpectedStatus || '',
        ResponsibleTeam: row.ResponsibleTeam || '',
        TeamAssignment: row.TeamAssignment || ASSIGNMENT.OPEN,
        TeamAssignmentCriticality: criticalityOf(row.TeamAssignment || ASSIGNMENT.OPEN),
        Variants: row.Variants || '',
        PilotScope: row.PilotScope || 'PILOT',
        Automation: row.Automation || catalog.AUTOMATION.MANUAL,
        IsHandover: false,
        TestCaseCount: 0
    };
}

async function initialProcessVariant(repo, row) {
    return {
        Sequence: row.Sequence || (await nextSequence(repo, 'ProcessVariant', row.ProcessID)),
        PilotScope: row.PilotScope || 'PILOT',
        IsDefault: row.IsDefault ?? false,
        StepPath: '',
        DocumentPath: '',
        TestCaseCount: 0
    };
}

/**
 * Determination on modify of a process step: the team assignment follows the responsible team
 * (no team → OPEN; a team entered for an open step → ASSIGNED; ASSUMED stays until somebody confirms it).
 */
function onProcessStepChanged(step, changed) {
    const patch = {};
    if (changed.includes('ResponsibleTeam')) {
        if (isEmpty(step.ResponsibleTeam)) {
            patch.TeamAssignment = ASSIGNMENT.OPEN;
        } else if (step.TeamAssignment === ASSIGNMENT.OPEN || isEmpty(step.TeamAssignment)) {
            patch.TeamAssignment = ASSIGNMENT.ASSIGNED;
        }
    }
    if (changed.includes('BusinessObjectType') && isEmpty(step.BusinessObjectType) && step.Automation === catalog.AUTOMATION.AUTOMATED) {
        patch.Automation = catalog.AUTOMATION.MANUAL;
    }
    patch.TeamAssignmentCriticality = criticalityOf(patch.TeamAssignment || step.TeamAssignment);
    return patch;
}

/**
 * Validation on save (Prepare) of a process draft.
 *
 * @param {object} repo repository
 * @param {string} processId process ID
 */
async function validateBusinessProcess(repo, processId) {
    const process = await repo.findOne('BusinessProcess', { ProcessID: processId, IsActiveEntity: false });
    if (!process) {
        return;
    }
    if (isEmpty(process.ProcessName)) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 130, 'Enter a name for the process.', 'ProcessName');
    }
    const teams = new Set((await repo.find('ProcessTeamVH')).map((t) => t.ProcessTeam));
    if (!isEmpty(process.OwnerTeam) && !teams.has(process.OwnerTeam)) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 131, `Process team ${process.OwnerTeam} does not exist.`, 'OwnerTeam');
    }
    const steps = await repo.find('ProcessStep', { ProcessID: processId, IsActiveEntity: false });
    const variants = await repo.find('ProcessVariant', { ProcessID: processId, IsActiveEntity: false });
    const variantCodes = new Set();
    for (const variant of variants) {
        if (isEmpty(variant.Variant)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 132, `Process variant ${variant.Sequence}: enter a variant code.`);
        }
        if (variantCodes.has(variant.Variant)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 133, `Process variant ${variant.Variant} is maintained more than once.`);
        }
        variantCodes.add(variant.Variant);
    }
    const defaults = variants.filter((v) => v.IsDefault === true);
    if (variants.length && defaults.length !== 1) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 134, 'Mark exactly one process variant as default (used for new test cases).');
    }
    if (defaults[0] && defaults[0].PilotScope !== 'PILOT') {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 135, `The default variant ${defaults[0].Variant} must be part of the pilot.`);
    }
    const stepIds = new Set();
    for (const step of steps) {
        if (isEmpty(step.StepID) || isEmpty(step.StepName)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 136, `Process step ${step.Sequence}: enter step ID and name.`);
        }
        if (stepIds.has(step.StepID)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 137, `Step ID ${step.StepID} is used more than once.`);
        }
        stepIds.add(step.StepID);
        if (!isEmpty(step.BusinessObjectType) && !KNOWN_BOS.has(step.BusinessObjectType)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 138, `Step ${step.StepID}: business object ${step.BusinessObjectType} is not part of the service chain.`);
        }
        if (step.Automation === catalog.AUTOMATION.AUTOMATED && isEmpty(step.BusinessObjectType)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 139, `Step ${step.StepID}: an automated step needs a business object.`);
        }
        if (!PILOT_SCOPES.has(step.PilotScope) || !AUTOMATIONS.has(step.Automation)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 140, `Step ${step.StepID}: select pilot scope and automation.`);
        }
        if (!isEmpty(step.ResponsibleTeam) && !teams.has(step.ResponsibleTeam)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 141, `Step ${step.StepID}: process team ${step.ResponsibleTeam} does not exist.`);
        }
        for (const code of catalog.variantsOf(step)) {
            if (!variantCodes.has(code)) {
                throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 142, `Step ${step.StepID} refers to the unknown process variant ${code}.`);
            }
        }
    }
}

/** Content relevant for the process version (not the derived fields) */
function processContent(process, steps, variants) {
    const pick = (row, fields) => Object.fromEntries(fields.map((f) => [f, row[f] ?? '']));
    return {
        process: pick(process, ['ProcessName', 'Description', 'ProcessArea', 'OwnerTeam', 'PilotScope', 'SAPReference']),
        steps: steps
            .map((s) =>
                pick(s, [
                    'Sequence',
                    'StepID',
                    'StepName',
                    'BusinessObjectType',
                    'ExpectedStatus',
                    'ResponsibleTeam',
                    'TeamAssignment',
                    'Variants',
                    'PilotScope',
                    'Automation',
                    'TestAction',
                    'TestExpectedResult'
                ])
            )
            .sort((a, b) => String(a.StepID).localeCompare(String(b.StepID))),
        variants: variants.map((v) => pick(v, ['Variant', 'VariantName', 'Description', 'PilotScope', 'IsDefault'])).sort((a, b) => String(a.Variant).localeCompare(String(b.Variant)))
    };
}

/**
 * Derived fields of the active process model: handover flags, step and document paths, counts, modeling status.
 *
 * @param {object} repo repository
 * @param {string} processId process ID
 */
async function deriveProcess(repo, processId) {
    const { process, steps, variants } = await processModel(repo, processId);
    if (!process) {
        return;
    }
    const handover = new Set();
    for (const variant of variants) {
        const path = catalog.variantPath(steps, variant.Variant);
        catalog.handovers(path).forEach((flag, index) => {
            if (flag) {
                handover.add(path[index].StepID);
            }
        });
        const pilotPath = path.filter((s) => s.PilotScope === catalog.PILOT || variant.PilotScope !== catalog.PILOT);
        await repo.update(
            'ProcessVariant',
            { VariantUUID: variant.VariantUUID, IsActiveEntity: true },
            { StepPath: catalog.stepPath(pilotPath).slice(0, 255), DocumentPath: catalog.documentPath(pilotPath).slice(0, 120) }
        );
    }
    for (const step of steps) {
        await repo.update(
            'ProcessStep',
            { ProcessStepUUID: step.ProcessStepUUID, IsActiveEntity: true },
            { IsHandover: handover.has(step.StepID), TeamAssignmentCriticality: criticalityOf(step.TeamAssignment) }
        );
    }
    const modeling = steps.length ? ASSIGNMENT.ASSIGNED : ASSIGNMENT.OPEN;
    await repo.update(
        'BusinessProcess',
        { ProcessID: processId, IsActiveEntity: true },
        { StepCount: steps.length, VariantCount: variants.length, ModelingStatus: modeling, ModelingCriticality: criticalityOf(modeling) }
    );
}

/** Read models of a process: BusinessProcessVH, ProcessVariantVH, ProcessStepVH */
async function syncProcessValueHelps(repo, processId) {
    const { process, steps, variants } = await processModel(repo, processId);
    const vh = await repo.findOne('BusinessProcessVH', { ProcessID: processId });
    if (process) {
        const row = {
            ProcessID: processId,
            ProcessName: process.ProcessName,
            OwnerTeam: process.OwnerTeam || '',
            ProcessVersion: process.ProcessVersion || 0,
            PilotScope: process.PilotScope || ''
        };
        if (vh) {
            await repo.update('BusinessProcessVH', { ProcessID: processId }, row);
        } else {
            await repo.add('BusinessProcessVH', row);
        }
    }
    for (const row of await repo.find('ProcessVariantVH', { ProcessID: processId })) {
        await repo.remove('ProcessVariantVH', { ProcessID: processId, Variant: row.Variant });
    }
    for (const row of await repo.find('ProcessStepVH', { ProcessID: processId })) {
        await repo.remove('ProcessStepVH', { ProcessID: processId, StepID: row.StepID });
    }
    for (const variant of variants) {
        await repo.add('ProcessVariantVH', {
            ProcessID: processId,
            Variant: variant.Variant,
            VariantName: variant.VariantName,
            PilotScope: variant.PilotScope,
            IsDefault: variant.IsDefault === true
        });
    }
    for (const step of [...steps].sort((a, b) => a.Sequence - b.Sequence)) {
        await repo.add('ProcessStepVH', {
            ProcessID: processId,
            StepID: step.StepID,
            StepName: step.StepName,
            Sequence: step.Sequence,
            BusinessObjectType: step.BusinessObjectType || '',
            ResponsibleTeam: step.ResponsibleTeam || '',
            TeamAssignment: step.TeamAssignment || ASSIGNMENT.OPEN,
            Variants: step.Variants || '',
            PilotScope: step.PilotScope,
            Automation: step.Automation
        });
    }
}

/**
 * Activation of a process (after the mock server copied the draft): new process version when the model changed.
 *
 * @param {object} repo repository
 * @param {string} processId process ID
 * @param {string} user user
 * @returns {Promise<{versioned: boolean, version: number}>} result
 */
async function onProcessActivated(repo, processId, user) {
    const { process, steps, variants } = await processModel(repo, processId);
    if (!process) {
        return { versioned: false, version: 0 };
    }
    const hash = catalog.contentHash(processContent(process, steps, variants));
    let versioned = false;
    let version = Number(process.ProcessVersion) || 0;
    if (hash !== process.ContentHash) {
        version += 1;
        versioned = true;
        const now = clock.nowIso();
        await repo.add('ProcessVersion', {
            ProcessVersionUUID: uuid(),
            ProcessID: processId,
            ProcessVersion: version,
            ActivatedAt: now,
            ActivatedBy: user,
            VersionNote: process.VersionNote || (version === 1 ? 'Initial version' : 'Process model changed'),
            StepCount: steps.length,
            VariantCount: variants.length,
            ContentHash: hash
        });
        await repo.update(
            'BusinessProcess',
            { ProcessID: processId, IsActiveEntity: true },
            { ProcessVersion: version, VersionActivatedAt: now, VersionActivatedBy: user, ContentHash: hash, VersionNote: '' }
        );
    }
    await deriveProcess(repo, processId);
    await syncProcessValueHelps(repo, processId);
    return { versioned, version };
}

module.exports = {
    processModel,
    initialProcessTeam,
    initialTeamMember,
    validateProcessTeam,
    syncTeamValueHelps,
    initialBusinessProcess,
    initialProcessStep,
    initialProcessVariant,
    onProcessStepChanged,
    validateBusinessProcess,
    processContent,
    deriveProcess,
    syncProcessValueHelps,
    onProcessActivated
};
