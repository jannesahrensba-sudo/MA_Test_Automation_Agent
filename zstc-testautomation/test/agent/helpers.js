'use strict';
/**
 * Test helpers for the agent core (webapp/ext/agent/core): a minimal sap.ui.define loader for Node and an in-memory
 * gateway that runs the same mock backend services as the OData mock server.
 */
const path = require('path');
const service = require('../../mock-backend/services/TestCaseService');
const releaseService = require('../../mock-backend/services/ReleaseService');
const backendHelpers = require('../../mock-backend/test/helpers');
const { loadUi5Module } = require('../../tools/common/loadUi5Module');

const CORE_DIR = path.join(__dirname, '../../webapp/ext/agent/core');

const core = (name) => loadUi5Module(path.join(CORE_DIR, name));

/** In-memory gateway with the interface of webapp/ext/agent/TestCaseGateway.js */
function createMemoryGateway(repo) {
    const { createMasterData } = core('masterData');
    // value help pools of the gateway (TestCaseGateway.VALUE_HELPS), including the process reference
    const pools = {
        ...backendHelpers.pools(repo),
        processTeams: repo.data.ProcessTeamVH,
        processes: repo.data.BusinessProcessVH,
        variants: repo.data.ProcessVariantVH,
        releases: repo.data.ReleaseVH,
        serviceContracts: repo.data.ServiceContractVH,
        testCases: repo.data.TestCaseVH
    };
    const masterData = createMasterData(pools);
    /** header fields of the process reference (TestCaseGateway.HEADER_FIELDS) */
    const HEADER_FIELDS = {
        description: 'Description',
        scenarioId: 'ScenarioID',
        processTeam: 'ProcessTeam',
        processVariant: 'ProcessVariant',
        endObject: 'EndObject',
        startObject: 'StartObject',
        preconditions: 'Preconditions',
        predecessorTestCase: 'PredecessorTestCase'
    };
    const draftKeys = (uuid) => ({ TestCaseUUID: uuid, IsActiveEntity: false });
    const activeKeys = (uuid) => ({ TestCaseUUID: uuid, IsActiveEntity: true });
    const calls = [];
    const gateway = {
        calls,
        async masterData() {
            return masterData;
        },
        async catalog() {
            return {
                processProfiles: pools.processProfiles,
                processTeams: pools.processTeams,
                variants: pools.variants.filter((v) => v.PilotScope === 'PILOT'),
                releasesInTest: pools.releases.filter((r) => r.ReleaseStatus === 'IN_TEST')
            };
        },
        async createDraft({ processProfile, title, text }) {
            calls.push(['createDraft', processProfile]);
            const keys = await backendHelpers.createDraft(repo, processProfile || 'FS_TM', text || '');
            if (title) {
                await repo.update('TestCase', keys, { Title: title });
            }
            return keys.TestCaseUUID;
        },
        async updateDraft(uuid, header, fields) {
            calls.push(['updateDraft', fields, header]);
            if (header && header.title) {
                await repo.update('TestCase', draftKeys(uuid), { Title: header.title });
            }
            // process reference first, as in the OData PATCH (TestCase.js: onAfterUpdateEntry → onProcessReferenceChanged)
            // two PATCH requests like the gateway: first the process reference, then the predecessor (depends on the start)
            for (const keys of [Object.keys(HEADER_FIELDS).filter((key) => key !== 'predecessorTestCase'), ['predecessorTestCase']]) {
                const headerPatch = {};
                for (const key of keys) {
                    if (header && header[key] !== undefined && header[key] !== null) {
                        headerPatch[HEADER_FIELDS[key]] = header[key];
                    }
                }
                if (Object.keys(headerPatch).length) {
                    const stored = await repo.findOne('TestCase', draftKeys(uuid));
                    const changed = service.PROCESS_FIELDS.filter((field) => field in headerPatch && String(stored[field] ?? '') !== String(headerPatch[field]));
                    await repo.update('TestCase', draftKeys(uuid), headerPatch);
                    if (changed.length) {
                        await service.onProcessReferenceChanged(repo, draftKeys(uuid), changed);
                    }
                }
            }
            if (fields && Object.keys(fields).length) {
                await repo.update('TestCaseData', draftKeys(uuid), fields);
                await service.onTestDataChanged(repo, draftKeys(uuid), Object.keys(fields));
            }
        },
        async analyzeDraft(uuid) {
            calls.push(['analyze']);
            await service.analyze(repo, draftKeys(uuid));
        },
        async validateDraft(uuid) {
            calls.push(['validate']);
            await service.validateTestCase(repo, draftKeys(uuid));
        },
        async readDraft(uuid, active) {
            const keys = active ? activeKeys(uuid) : draftKeys(uuid);
            return {
                testCase: await repo.findOne('TestCase', keys),
                values: await repo.findOne('TestCaseData', keys),
                findings: (await repo.find('ValidationResult', keys)).sort((a, b) => a.Sequence - b.Sequence)
            };
        },
        async saveDraft(uuid) {
            calls.push(['save']);
            await service.prepare(repo, draftKeys(uuid));
            const keys = await backendHelpers.activate(repo, draftKeys(uuid));
            return { caseId: (await repo.findOne('TestCase', keys)).CaseID };
        },
        async approve(uuid) {
            calls.push(['approve']);
            await service.approve(repo, activeKeys(uuid));
        },
        async startExecution(uuid) {
            calls.push(['start']);
            const { testCase } = await service.startExecution(repo, activeKeys(uuid));
            return { externalExecutionId: testCase.ExternalExecutionID };
        },
        async readResult(uuid, runId) {
            calls.push(['readResult', runId]);
            const keys = activeKeys(uuid);
            const testCase = await repo.findOne('TestCase', keys);
            const values = await repo.findOne('TestCaseData', keys);
            const chosen = runId && (await repo.find('Execution', keys)).find((e) => e.ExternalExecutionID === runId);
            const executionUUID = chosen ? chosen.ExecutionUUID : testCase.LatestExecutionUUID;
            if (!executionUUID) {
                return { testCase, values, execution: null, steps: [], assertions: [], documents: [], findings: [], history: [] };
            }
            const run = { ExecutionUUID: executionUUID, IsActiveEntity: true };
            const bySequence = (rows) => rows.sort((a, b) => a.Sequence - b.Sequence);
            return {
                testCase,
                values,
                execution: await repo.findOne('Execution', run),
                steps: bySequence(await repo.find('ExecutionStep', run)),
                assertions: bySequence(await repo.find('TestAssertion', run)),
                documents: bySequence(await repo.find('DocumentReference', run)),
                findings: bySequence(await repo.find('ResultFinding', run)),
                history: (await repo.find('Execution', keys)).sort((a, b) => String(b.StartedAt).localeCompare(String(a.StartedAt)))
            };
        },
        async findTestCase(caseId) {
            const found = await repo.find('TestCase', { CaseID: caseId, IsActiveEntity: true });
            return found.length ? found[0].TestCaseUUID : undefined;
        },
        async processModel() {
            const names = new Map(repo.data.ProcessTeamVH.map((t) => [t.ProcessTeam, t.ProcessTeamName]));
            return {
                steps: repo.data.ProcessStepVH.map((s) => ({ ...s, TeamName: names.get(s.ResponsibleTeam) || '' })),
                variants: repo.data.ProcessVariant.filter((v) => v.IsActiveEntity),
                processes: repo.data.BusinessProcessVH,
                teams: repo.data.ProcessTeamVH
            };
        },
        async testCases() {
            const rows = [];
            for (const tc of (await repo.find('TestCase', { IsActiveEntity: true })).sort((a, b) => String(a.CaseID).localeCompare(String(b.CaseID)))) {
                const data = (await repo.findOne('TestCaseData', activeKeys(tc.TestCaseUUID))) || {};
                rows.push({ ...tc, equipment: data.ServiceReferenceEquipment || '', contract: data.ServiceContract || '', customer: data.SoldToParty || '', LatestResult: tc.FinalResult || '' });
            }
            return rows;
        },
        async releases() {
            return (await repo.find('Release', { IsActiveEntity: true })).sort((a, b) => String(a.TestStartDate).localeCompare(String(b.TestStartDate)));
        },
        async scopes() {
            return repo.find('ReleaseScope', { IsActiveEntity: true });
        },
        async draftSteps(uuid, active) {
            return (await repo.find('TestCaseStep', active ? activeKeys(uuid) : draftKeys(uuid))).sort((a, b) => a.StepNo - b.StepNo);
        },
        async copyScope(releaseId) {
            calls.push(['copyScope', releaseId]);
            await releaseService.copyScopeFromPredecessor(repo, { ReleaseID: releaseId, IsActiveEntity: true });
        },
        async startTeamRun(releaseId, parameters) {
            calls.push(['startTeamRun', releaseId, parameters]);
            await releaseService.startTeamRegressionRun(repo, { ReleaseID: releaseId, IsActiveEntity: true }, parameters);
        },
        async refreshRun(releaseId) {
            calls.push(['refreshRun', releaseId]);
            await releaseService.refreshRegressionRun(repo, { ReleaseID: releaseId, IsActiveEntity: true });
        },
        async readRun(releaseId) {
            const release = await repo.findOne('Release', { ReleaseID: releaseId, IsActiveEntity: true });
            if (!release.LatestRunUUID) {
                return { release, run: null, items: [] };
            }
            const run = await repo.findOne('RegressionRun', { RunUUID: release.LatestRunUUID });
            const items = (await repo.find('RegressionRunItem', { RunUUID: release.LatestRunUUID })).sort((a, b) => a.Sequence - b.Sequence);
            return { release, run, items };
        },
        async discardDraft(uuid) {
            calls.push(['discard']);
            for (const row of await repo.find('ValidationResult', draftKeys(uuid))) {
                await repo.remove('ValidationResult', { ValidationUUID: row.ValidationUUID, IsActiveEntity: false });
            }
            for (const row of await repo.find('TestCaseStep', draftKeys(uuid))) {
                await repo.remove('TestCaseStep', { TestCaseStepUUID: row.TestCaseStepUUID, IsActiveEntity: false });
            }
            for (const set of ['TestCase', 'TestCaseData']) {
                await repo.remove(set, draftKeys(uuid));
            }
        }
    };
    return gateway;
}

module.exports = { loadUi5Module, core, createMemoryGateway, ...backendHelpers };
