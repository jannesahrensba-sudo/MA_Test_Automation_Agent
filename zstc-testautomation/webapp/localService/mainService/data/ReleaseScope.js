'use strict';
/**
 * FE mock server data contributor for the entity set ReleaseScope — the link table ("Zwischentabelle")
 * release × process team × business process (version), draft node of the release.
 */
const releaseService = require('../../../../mock-backend/services/ReleaseService');
const { run } = require('../../../../mock-backend/services/mockServerAdapter');

/** changed fields per PATCH request (onBefore → onAfterUpdateEntry) */
const changedFields = new WeakMap();

module.exports = {
    /** inline creation: team's pilot process in its current version, part of the regression */
    async onBeforeAddEntry(keys, data, odataRequest) {
        await run(this, odataRequest, async (repo) => Object.assign(data, await releaseService.initialScope(repo, data)));
    },

    async onBeforeUpdateEntry(keys, updatedData, odataRequest) {
        const stored = (await this.base.fetchEntries(keys, odataRequest))[0] || {};
        changedFields.set(
            odataRequest,
            ['ProcessTeam', 'ProcessID'].filter((field) => String(stored[field] ?? '') !== String(updatedData[field] ?? ''))
        );
    },

    /** determination: process of the team, current process version */
    async onAfterUpdateEntry(keys, updatedData, odataRequest) {
        const changed = changedFields.get(odataRequest) || [];
        changedFields.delete(odataRequest);
        if (!changed.length) {
            return;
        }
        await run(this, odataRequest, async (repo) => {
            const patch = await releaseService.scopeDefaults(repo, updatedData, changed);
            if (Object.keys(patch).length) {
                await repo.update('ReleaseScope', { ScopeUUID: updatedData.ScopeUUID, IsActiveEntity: updatedData.IsActiveEntity }, patch);
            }
        });
    }
};
