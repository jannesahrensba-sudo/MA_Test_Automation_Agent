'use strict';
/**
 * FE mock server data contributor for the entity set ValidationResult (validation findings, draft node).
 * Bound action applySuggestion; behavior in mock-backend/services/TestCaseService.js.
 */
const service = require('../../../../mock-backend/services/TestCaseService');
const { addMessages, run, applyDerived } = require('../../../../mock-backend/services/mockServerAdapter');

module.exports = {
    /** instance feature control of applySuggestion */
    async onAfterRead(data, odataRequest) {
        return applyDerived(data, async (row) => {
            if (!row.ValidationUUID || row.IsActiveEntity === undefined) {
                return undefined;
            }
            const stored = (await this.base.fetchEntries({ ValidationUUID: row.ValidationUUID, IsActiveEntity: row.IsActiveEntity }, odataRequest))[0];
            return stored ? service.deriveValidationResult(stored) : undefined;
        });
    },

    async executeAction(actionDefinition, actionData, keys, odataRequest) {
        if (actionDefinition.name !== 'applySuggestion') {
            return actionData;
        }
        return run(
            this,
            odataRequest,
            async (repo) => {
                const rowKeys = { ValidationUUID: keys.ValidationUUID, IsActiveEntity: keys.IsActiveEntity === true || keys.IsActiveEntity === 'true' };
                const { validationResult, messages } = await service.applySuggestion(repo, rowKeys, actionData?.SelectedValue);
                await service.syncDerived(repo, validationResult.TestCaseUUID);
                addMessages(odataRequest, messages);
                return repo.findOne('ValidationResult', rowKeys);
            },
            { boundAction: true }
        );
    }
};
