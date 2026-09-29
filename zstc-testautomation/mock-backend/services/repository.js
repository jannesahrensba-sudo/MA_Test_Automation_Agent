'use strict';
/**
 * Repository abstraction used by the mock backend services.
 *
 * - createMockServerRepository: wraps the FE mock server entity interfaces (this.base.getEntityInterface) for one request
 * - createMemoryRepository: plain in-memory implementation for unit tests and the seed generator
 */

/**
 * @param {object} base mock server base API of a data contributor (this.base)
 * @param {object} odataRequest current ODataRequest (tenant)
 * @returns {object} repository
 */
function createMockServerRepository(base, odataRequest) {
    const interfaces = new Map();
    const entityInterface = async (entitySet) => {
        if (!interfaces.has(entitySet)) {
            const iface = await base.getEntityInterface(entitySet);
            if (!iface) {
                throw new Error(`Unknown entity set ${entitySet}`);
            }
            interfaces.set(entitySet, iface);
        }
        return interfaces.get(entitySet);
    };
    return {
        tenantId: odataRequest.tenantId || 'tenant-default',
        async find(entitySet, filter = {}) {
            const iface = await entityInterface(entitySet);
            const entries = Object.keys(filter).length ? await iface.fetchEntries(filter, odataRequest) : await iface.getAllEntries(odataRequest, true);
            return entries.map((entry) => ({ ...entry }));
        },
        async findOne(entitySet, filter) {
            return (await this.find(entitySet, filter))[0];
        },
        async add(entitySet, entry) {
            const iface = await entityInterface(entitySet);
            await iface.addEntry({ ...entry }, odataRequest);
            return entry;
        },
        async update(entitySet, keys, patch) {
            const iface = await entityInterface(entitySet);
            const current = (await iface.fetchEntries(keys, odataRequest))[0];
            if (!current) {
                throw new Error(`${entitySet} ${JSON.stringify(keys)} not found`);
            }
            const merged = { ...current, ...patch };
            await iface.updateEntry(keys, merged, patch, odataRequest);
            return merged;
        },
        async remove(entitySet, keys) {
            const iface = await entityInterface(entitySet);
            if (keys.IsActiveEntity === false) {
                // like the mock server's DELETE on a draft node: the active twin is deleted on activation
                const activeTwin = (await iface.fetchEntries({ ...keys, IsActiveEntity: true }, odataRequest))[0];
                if (activeTwin?.HasDraftEntity) {
                    await this.update(entitySet, { ...keys, IsActiveEntity: true }, { HasDraftEntity: false });
                }
            }
            await iface.removeEntry(keys, odataRequest);
        }
    };
}

/**
 * @param {Record<string, object[]>} dataBySet initial data per entity set (mutated)
 * @param {string} [tenantId] tenant
 * @returns {object} repository
 */
function createMemoryRepository(dataBySet = {}, tenantId = 'tenant-test') {
    const matches = (entry, filter) => Object.entries(filter).every(([key, value]) => entry[key] === value);
    const set = (name) => {
        if (!dataBySet[name]) {
            dataBySet[name] = [];
        }
        return dataBySet[name];
    };
    return {
        tenantId,
        data: dataBySet,
        async find(entitySet, filter = {}) {
            return set(entitySet)
                .filter((entry) => matches(entry, filter))
                .map((entry) => ({ ...entry }));
        },
        async findOne(entitySet, filter) {
            return (await this.find(entitySet, filter))[0];
        },
        async add(entitySet, entry) {
            set(entitySet).push({ ...entry });
            return entry;
        },
        async update(entitySet, keys, patch) {
            const current = set(entitySet).find((entry) => matches(entry, keys));
            if (!current) {
                throw new Error(`${entitySet} ${JSON.stringify(keys)} not found`);
            }
            Object.assign(current, patch);
            return { ...current };
        },
        async remove(entitySet, keys) {
            const rows = set(entitySet);
            const index = rows.findIndex((entry) => matches(entry, keys));
            if (index >= 0) {
                rows.splice(index, 1);
            }
        }
    };
}

module.exports = { createMockServerRepository, createMemoryRepository };
