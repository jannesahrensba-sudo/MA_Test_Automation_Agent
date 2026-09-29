'use strict';
// Minimal POSIX path shim for the browser build of the mock server (only what fe-mockserver-core uses)
function normalize(p) {
    const absolute = p.startsWith('/');
    const out = [];
    for (const part of p.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') out.pop();
        else out.push(part);
    }
    return (absolute ? '/' : '') + out.join('/');
}
const join = (...parts) => normalize(parts.filter((p) => p !== undefined && p !== null && p !== '').join('/'));
const dirname = (p) => {
    const n = normalize(p);
    const i = n.lastIndexOf('/');
    return i > 0 ? n.slice(0, i) : i === 0 ? '/' : '.';
};
const basename = (p, ext) => {
    const b = normalize(p).split('/').pop() || '';
    return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b;
};
const extname = (p) => {
    const b = basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i) : '';
};
const resolve = (...parts) => normalize(parts.reduce((acc, p) => (p.startsWith('/') ? p : `${acc}/${p}`), '/'));
const relative = (from, to) => {
    const f = normalize(from).split('/').filter(Boolean);
    const t = normalize(to).split('/').filter(Boolean);
    while (f.length && t.length && f[0] === t[0]) {
        f.shift();
        t.shift();
    }
    return [...f.map(() => '..'), ...t].join('/');
};
const api = { sep: '/', delimiter: ':', normalize, join, dirname, basename, extname, resolve, relative, isAbsolute: (p) => p.startsWith('/') };
api.posix = api;
module.exports = api;
