'use strict';
// util shim: inspect/format are only used for debug logging
const inspect = (value) => {
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
};
const format = (...args) => args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' ');
module.exports = { inspect, format, types: {}, promisify: (fn) => (...args) => new Promise((res, rej) => fn(...args, (e, v) => (e ? rej(e) : res(v)))) };
