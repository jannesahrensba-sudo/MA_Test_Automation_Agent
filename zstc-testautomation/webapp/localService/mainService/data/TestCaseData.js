'use strict';
/**
 * FE mock server data contributor for the entity set TestCaseData (1:1 draft node: the test data per business object).
 * Behavior in mock-backend/services/TestCaseService.js; initial data: TestCaseData.json.
 */
const service = require('../../../../mock-backend/services/TestCaseService');
const { run, applyDerived } = require('../../../../mock-backend/services/mockServerAdapter');

/** changed fields per PATCH request (onBefore → onAfterUpdateEntry) */
const changedFields = new WeakMap();

module.exports = {
    async onBeforeUpdateEntry(keys, updatedData, odataRequest) {
        const stored = (await this.base.fetchEntries(keys, odataRequest))[0] || {};
        changedFields.set(
            odataRequest,
            service.CONTROLLED_FIELDS.filter((field) => String(stored[field] ?? '') !== String(updatedData[field] ?? ''))
        );
    },

    /** determinations on modify + invalidation of validation and approval */
    async onAfterUpdateEntry(keys, updatedData, odataRequest) {
        const fields = changedFields.get(odataRequest) || [];
        changedFields.delete(odataRequest);
        if (!fields.length) {
            return;
        }
        await run(this, odataRequest, async (repo) => {
            const dataKeys = { TestCaseUUID: updatedData.TestCaseUUID, IsActiveEntity: updatedData.IsActiveEntity };
            await service.onTestDataChanged(repo, dataKeys, fields);
            await service.syncDerived(repo, updatedData.TestCaseUUID);
        });
    },

    /** dynamic field control (mandatory / optional / hidden) from the FieldRequirement customizing of the process profile */
    async onAfterRead(data, odataRequest) {
        return run(this, odataRequest, (repo) =>
            applyDerived(data, async (row) => {
                if (!row.TestCaseUUID || row.IsActiveEntity === undefined || !Object.prototype.hasOwnProperty.call(row, '__FieldControl')) {
                    return undefined;
                }
                const tc = await repo.findOne('TestCase', { TestCaseUUID: row.TestCaseUUID, IsActiveEntity: row.IsActiveEntity });
                return tc ? { __FieldControl: service.fieldControl(await service.getRequirements(repo, tc.ProcessProfile)) } : undefined;
            })
        );
    }
};
