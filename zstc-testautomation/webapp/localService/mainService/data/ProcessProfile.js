'use strict';
/**
 * FE mock server data contributor for the entity set ProcessProfile (draft root of the configuration).
 * Behavior in mock-backend/services/ConfigurationService.js; initial data: ProcessProfile.json.
 */
const config = require('../../../../mock-backend/services/ConfigurationService');
const { run } = require('../../../../mock-backend/services/mockServerAdapter');

module.exports = {
    async onBeforeAddEntry(keys, data) {
        Object.assign(data, config.initialProcessProfile(data));
    },

    /** Prepare (Save, step 1): validation of the customizing */
    async onDraftPrepare(actionDefinition, responseData, keys, odataRequest) {
        await run(this, odataRequest, (repo) => config.validateProcessProfile(repo, keys.ProcessProfile), { boundAction: true });
    },

    async onAfterAction(actionDefinition, actionData, keys, responseData, odataRequest) {
        const response = await responseData;
        if (actionDefinition.name === 'Activate' && keys?.ProcessProfile) {
            await run(this, odataRequest, (repo) => config.syncProcessProfileValueHelp(repo, keys.ProcessProfile));
        }
        return response;
    }
};
