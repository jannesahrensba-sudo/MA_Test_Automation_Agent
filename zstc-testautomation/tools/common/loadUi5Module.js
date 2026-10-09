'use strict';
/**
 * Minimal sap.ui.define loader for Node: loads UI5-free AMD modules of the app (e.g. webapp/ext/agent/core/*) without
 * UI5. Dependencies are resolved relative to the module; UI5 framework dependencies are not available. Used by the unit
 * tests and by the seed generator (same test design as the service assistant).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const cache = new Map();

/**
 * @param {string} file path of the module (with or without .js)
 * @returns {*} export of the module factory
 */
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
                        throw new Error(`UI5 dependency ${dep} is not available in Node`);
                    }
                    return loadUi5Module(path.join(path.dirname(absolute), dep));
                });
                exported = factory(...resolved);
            }
        }
    };
    // same realm as the caller (no cross-realm arrays), only sap.ui.define is provided
    vm.runInThisContext(`(function (sap) {${fs.readFileSync(absolute, 'utf8')}\n})`, { filename: absolute })(sap);
    cache.set(absolute, exported);
    return exported;
}

module.exports = { loadUi5Module };
