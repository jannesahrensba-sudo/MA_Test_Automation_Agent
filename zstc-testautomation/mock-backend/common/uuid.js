'use strict';
/**
 * RFC 4122 version 4 UUID. Uses crypto.randomUUID where available (Node.js, secure browser contexts) and falls back
 * to crypto.getRandomValues (browsers outside secure contexts).
 *
 * @returns {string} UUID
 */
function newUUID() {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Name-based UUID (RFC 9562 version 8 layout, FNV-1a over the name): the same name always gives the same key.
 * Used for rows of read models that are recomputed — stable keys let the UI keep its cached rows across refreshes.
 *
 * @param {string} name unique name of the row, e.g. "ReleaseTestCase|INT-2026.10|<TestCaseUUID>"
 * @returns {string} UUID
 */
function stableUUID(name) {
    const text = String(name);
    let hex = '';
    for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
        let hash = seed >>> 0;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        // avalanche (MurmurHash3 finalizer), so that the four parts differ even for short names
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x85ebca6b);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 0xc2b2ae35);
        hash ^= hash >>> 16;
        hex += (hash >>> 0).toString(16).padStart(8, '0');
    }
    const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

module.exports = { newUUID, stableUUID };
