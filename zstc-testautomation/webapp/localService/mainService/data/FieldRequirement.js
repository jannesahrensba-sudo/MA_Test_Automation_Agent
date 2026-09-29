'use strict';
/**
 * FE mock server data contributor for the entity set FieldRequirement (draft node of the process profile).
 * Behavior in mock-backend/services/ConfigurationService.js; initial data: FieldRequirement.json.
 */
const config = require('../../../../mock-backend/services/ConfigurationService');
const { run } = require('../../../../mock-backend/services/mockServerAdapter');

module.exports = {
    /** inline creation: defaults (sequence, business object, rule, source) */
    async onBeforeAddEntry(keys, data, odataRequest) {
        await run(this, odataRequest, async (repo) => Object.assign(data, await config.initialFieldRequirement(repo, data)));
    }
};
