'use strict';
// process shim: logging of the mock server goes to the browser console
const write = (method) => ({ write: (text) => console[method](String(text).trimEnd()) });
module.exports = { env: {}, platform: 'browser', cwd: () => '/', stdout: write('debug'), stderr: write('warn'), version: 'v20.0.0', versions: {}, nextTick: (fn, ...a) => Promise.resolve().then(() => fn(...a)) };
