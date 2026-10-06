'use strict';
/**
 * Test helpers for the agent core (webapp/ext/agent/core): a minimal sap.ui.define loader for Node and an in-memory
 * gateway that runs the same mock backend services as the OData mock server.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const service = require('../../mock-backend/services/TestCaseService');
const backendHelpers = require('../../mock-backend/test/helpers');

const CORE_DIR = path.join(__dirname, '../../webapp/ext/agent/core');
const cache = new Map();

/** Loads a UI5 AMD module (sap.ui.define) without UI5: dependencies are resolved relative to the module */
function loadUi5Module(file) {
    const absolute = path.resolve(file.endsWith('.js') ? file : `${file}.js`);
    if (cache.has(absolute)) {
        return cache.get(absolute);
    }
    let exported;
    const sap = {
        ui: {
            define(deps, factory) {
                const resolved = deps.map((dep) => {
                    if (!dep.startsWith('.')) {
                        throw new Error(`UI5 dependency ${dep} is not available in Node tests`);
                    }
                    return loadUi5Module(path.join(path.dirname(absolute), dep));
                });
                exported = factory(...resolved);
            }
        }
    };
    // same realm as the tests (no cross-realm arrays), only sap.ui.define is provided
    vm.runInThisContext(`(function (sap) {${fs.readFileSync(absolute, 'utf8')}\n})`, { filename: absolute })(sap);
    cache.set(absolute, exported);
    return exported;
}

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
