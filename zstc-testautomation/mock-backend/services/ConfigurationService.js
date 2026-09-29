'use strict';
/**
 * ConfigurationService — behavior of the configuration BO "process profile" with its field requirements
 * (customizing that drives mandatory fields, default values and validation rules of the test data).
 */
const { isEmpty } = require('../validation/ValidationEngine');
const { CATEGORY, MockServiceError } = require('../common/messages');

const DEFAULT_EXECUTION_PROVIDER = 'MOCK';

/** Initial values of a new process profile draft */
function initialProcessProfile(profile) {
    return {
        ProcessProfileName: profile.ProcessProfileName || '',
        ExecutionProvider: profile.ExecutionProvider || DEFAULT_EXECUTION_PROVIDER,
        RequiresSecondApprover: profile.RequiresSecondApprover ?? false,
        IsActive: profile.IsActive ?? true,
        SAP__Messages: [],
        __EntityControl: { Updatable: true, Deletable: true }
    };
}

/**
 * Initial values of a new field requirement row (inline creation in the draft).
 *
 * @param {object} repo repository
 * @param {object} row new row (with ProcessProfile and IsActiveEntity from the navigation)
 * @returns {Promise<object>} defaults
 */
async function initialFieldRequirement(repo, row) {
    const siblings = await repo.find('FieldRequirement', { ProcessProfile: row.ProcessProfile, IsActiveEntity: false });
    const maxSequence = siblings.reduce((max, r) => Math.max(max, Number(r.Sequence) || 0), 0);
    return {
        Sequence: row.Sequence || maxSequence + 10,
        BusinessObject: row.BusinessObject || 'SERVICE_REQUEST',
        Required: row.Required ?? false,
        ValidationRule: row.ValidationRule || 'NONE',
        SourceType: row.SourceType || 'USER',
        Active: row.Active ?? true
    };
}

/**
 * Validation on save (Prepare) of a process profile draft: unique fields, known field names.
 *
 * @param {object} repo repository
 * @param {string} processProfile key
 */
async function validateProcessProfile(repo, processProfile) {
    const profile = await repo.findOne('ProcessProfile', { ProcessProfile: processProfile, IsActiveEntity: false });
    if (!profile) {
        return;
    }
    if (isEmpty(profile.ProcessProfileName)) {
        throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 110, 'Enter a name for the process profile.', 'ProcessProfileName');
    }
    const rows = await repo.find('FieldRequirement', { ProcessProfile: processProfile, IsActiveEntity: false });
    const known = new Set((await repo.find('TestCaseFieldVH')).map((f) => f.FieldName));
    const seen = new Set();
    for (const row of rows) {
        if (isEmpty(row.FieldName)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 111, `Field requirement ${row.Sequence}: select a field.`);
        }
        if (!known.has(row.FieldName)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 112, `Field requirement ${row.Sequence}: field ${row.FieldName} is not part of the test data.`);
        }
        if (seen.has(row.FieldName)) {
            throw new MockServiceError(CATEGORY.VALIDATION_ERROR, 113, `Field ${row.FieldName} is maintained more than once.`);
        }
        seen.add(row.FieldName);
    }
}

/**
 * Keeps the value help ProcessProfileVH (fixed values of the test case field "Process Profile") in sync with the
 * active process profiles — on the real system this is a CDS view on the same table.
 *
 * @param {object} repo repository
 * @param {string} processProfile key
 */
async function syncProcessProfileValueHelp(repo, processProfile) {
    const active = await repo.findOne('ProcessProfile', { ProcessProfile: processProfile, IsActiveEntity: true });
    const vh = await repo.findOne('ProcessProfileVH', { ProcessProfile: processProfile });
    if (active && active.IsActive !== false) {
        if (vh) {
            await repo.update('ProcessProfileVH', { ProcessProfile: processProfile }, { ProcessProfileName: active.ProcessProfileName });
        } else {
            await repo.add('ProcessProfileVH', { ProcessProfile: processProfile, ProcessProfileName: active.ProcessProfileName });
        }
    } else if (vh) {
        await repo.remove('ProcessProfileVH', { ProcessProfile: processProfile });
    }
}

module.exports = { DEFAULT_EXECUTION_PROVIDER, initialProcessProfile, initialFieldRequirement, validateProcessProfile, syncProcessProfileValueHelp };
