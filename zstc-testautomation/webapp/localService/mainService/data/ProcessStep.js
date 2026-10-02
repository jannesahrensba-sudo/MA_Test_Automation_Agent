'use strict';
/**
 * FE mock server data contributor for the entity set ProcessStep (process steps, draft node of the business process).
 */
const processService = require('../../../../mock-backend/services/ProcessService');
const { run } = require('../../../../mock-backend/services/mockServerAdapter');

/** changed fields per PATCH request (onBefore → onAfterUpdateEntry) */
const changedFields = new WeakMap();

module.exports = {
    async onBeforeAddEntry(keys, data, odataRequest) {
        await run(this, odataRequest, async (repo) => Object.assign(data, await processService.initialProcessStep(repo, data)));
    },

    async onBeforeUpdateEntry(keys, updatedData, odataRequest) {
        const stored = (await this.base.fetchEntries(keys, odataRequest))[0] || {};
        changedFields.set(
            odataRequest,
            ['ResponsibleTeam', 'BusinessObjectType', 'TeamAssignment'].filter((field) => String(stored[field] ?? '') !== String(updatedData[field] ?? ''))
        );
    },

    /** determination: the team assignment follows the responsible team */
    async onAfterUpdateEntry(keys, updatedData, odataRequest) {
        const changed = changedFields.get(odataRequest) || [];
        changedFields.delete(odataRequest);
        if (!changed.length) {
            return;
        }
        await run(this, odataRequest, (repo) =>
            repo.update(
                'ProcessStep',
                { ProcessStepUUID: updatedData.ProcessStepUUID, IsActiveEntity: updatedData.IsActiveEntity },
                processService.onProcessStepChanged(updatedData, changed)
            )
        );
    }
};
