'use strict';
/**
 * FE mock server data contributor for the entity set TeamMember (members and roles of a process team, draft node).
 * Business responsibility (PROCESS_OWNER) and execution authorization (TEST_EXECUTOR) are separate rows.
 */
const processService = require('../../../../mock-backend/services/ProcessService');

module.exports = {
    async onBeforeAddEntry(keys, data) {
        Object.assign(data, processService.initialTeamMember(data));
    }
};
