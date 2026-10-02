'use strict';
/**
 * FE mock server data contributor for the entity set ProcessVariant (ways through the process, draft node).
 */
const processService = require('../../../../mock-backend/services/ProcessService');
const { run } = require('../../../../mock-backend/services/mockServerAdapter');

module.exports = {
    async onBeforeAddEntry(keys, data, odataRequest) {
        await run(this, odataRequest, async (repo) => Object.assign(data, await processService.initialProcessVariant(repo, data)));
    }
};
