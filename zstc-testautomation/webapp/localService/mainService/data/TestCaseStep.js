'use strict';
/**
 * FE mock server data contributor for the entity set TestCaseStep (test steps of a test case, draft node).
 * Steps are derived from the process variant (source DERIVED); manual steps (source USER) can be added.
 * Behavior in mock-backend/services/TestCaseService.js and mock-backend/process/*.
 */
const { run } = require('../../../../mock-backend/services/mockServerAdapter');
const { criticalityOf } = require('../../../../mock-backend/common/codes');

/** changed process step per PATCH request (onBefore → onAfterUpdateEntry) */
const changedStep = new WeakSet();

module.exports = {
    /** inline creation of a manual step: next step number, source USER, open team assignment */
    async onBeforeAddEntry(keys, data, odataRequest) {
        await run(this, odataRequest, async (repo) => {
            const siblings = await repo.find('TestCaseStep', { TestCaseUUID: data.TestCaseUUID, IsActiveEntity: false });
            const tc = await repo.findOne('TestCase', { TestCaseUUID: data.TestCaseUUID, IsActiveEntity: false });
            Object.assign(data, {
                StepNo: data.StepNo || siblings.reduce((max, s) => Math.max(max, Number(s.StepNo) || 0), 0) + 10,
                ProcessID: tc?.BusinessProcess || '',
                ProcessStepID: data.ProcessStepID || '',
                StepName: data.StepName || '',
                BusinessObjectType: data.BusinessObjectType || '',
                Action: data.Action || '',
                ExpectedResult: data.ExpectedResult || '',
                ResponsibleTeam: '',
                TeamAssignment: 'OPEN',
                TeamAssignmentCriticality: criticalityOf('OPEN'),
                IsHandover: false,
                Automation: 'MANUAL',
                StepSource: 'USER'
            });
        });
    },

    async onBeforeUpdateEntry(keys, updatedData, odataRequest) {
        const stored = (await this.base.fetchEntries(keys, odataRequest))[0];
        if (stored && stored.ProcessStepID !== updatedData.ProcessStepID) {
            changedStep.add(odataRequest);
        }
    },

    /** determination: a selected process step brings its name, business object, team and automation */
    async onAfterUpdateEntry(keys, updatedData, odataRequest) {
        if (!changedStep.has(odataRequest)) {
            return;
        }
        changedStep.delete(odataRequest);
        await run(this, odataRequest, async (repo) => {
            // step IDs are unique per process; a step of the test case's process wins over a step of another process
            const candidates = updatedData.ProcessStepID ? await repo.find('ProcessStepVH', { StepID: updatedData.ProcessStepID }) : [];
            const step = candidates.find((c) => c.ProcessID === updatedData.ProcessID) || candidates[0];
            const assignment = step ? step.TeamAssignment || 'OPEN' : 'OPEN';
            await repo.update(
                'TestCaseStep',
                { TestCaseStepUUID: updatedData.TestCaseStepUUID, IsActiveEntity: updatedData.IsActiveEntity },
                {
                    ProcessID: step?.ProcessID || updatedData.ProcessID || '',
                    StepName: step?.StepName || '',
                    BusinessObjectType: step?.BusinessObjectType || '',
                    ResponsibleTeam: step?.ResponsibleTeam || '',
                    TeamAssignment: assignment,
                    TeamAssignmentCriticality: criticalityOf(assignment),
                    Automation: step ? (step.PilotScope === 'PILOT' ? step.Automation : 'PLANNED') : 'MANUAL'
                }
            );
        });
    }
};
