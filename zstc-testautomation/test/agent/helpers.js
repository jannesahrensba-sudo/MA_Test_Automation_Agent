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
    const pools = backendHelpers.pools(repo);
    const masterData = createMasterData(pools);
    const draftKeys = (uuid) => ({ TestCaseUUID: uuid, IsActiveEntity: false });
    const activeKeys = (uuid) => ({ TestCaseUUID: uuid, IsActiveEntity: true });
    const calls = [];
    const gateway = {
        calls,
        async masterData() {
            return masterData;
        },
        async catalog() {
            return { processProfiles: pools.processProfiles };
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
            calls.push(['updateDraft', fields]);
            if (header && header.title) {
                await repo.update('TestCase', draftKeys(uuid), { Title: header.title });
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
        async readDraft(uuid) {
            const keys = (await repo.findOne('TestCase', draftKeys(uuid))) ? draftKeys(uuid) : activeKeys(uuid);
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
            for (const set of ['TestCase', 'TestCaseData']) {
                await repo.remove(set, draftKeys(uuid));
            }
        }
    };
    return gateway;
}

module.exports = { loadUi5Module, core, createMemoryGateway, ...backendHelpers };
