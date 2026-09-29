'use strict';
/**
 * Browser build of the local OData V4 mock service — used by the hosted mockup, which has no Node.js server.
 *
 * - The SAP Fiori elements mock server core runs unchanged in the browser (DataAccess, ODataRequest, $batch handler).
 * - Metadata, mock data and the data contributors are the SAME files that `ui5 serve` uses
 *   (webapp/localService/mainService), including the mock backend (validation, MockExecutionProvider, verification).
 * - The OData V4 model talks to the usual service URL; an XMLHttpRequest interceptor answers these requests
 *   in the browser. All other requests (UI5 resources) go to the network as usual.
 *
 * Mock only: nothing here is an SAP system or an SAP API.
 */
const { ODataMetadata } = require('@sap-ux/fe-mockserver-core/dist/data/metadata');
const { DataAccess } = require('@sap-ux/fe-mockserver-core/dist/data/dataAccess');
const ODataRequest = require('@sap-ux/fe-mockserver-core/dist/request/odataRequest').default;
const { batchRouter } = require('@sap-ux/fe-mockserver-core/dist/router/batchRouter');
const mockdata = require('./generated/mockdata');

const SERVICE_URL = '/sap/opu/odata4/sap/zui_stc_test_case_o4/srvd/sap/zui_stc_test_case/0001/';
const DATA_ROOT = '/data';

/* ------------------------------------------------------------------------------------------------ */
/* In-memory file loader (IFileLoader of fe-mockserver-core)                                         */
/* ------------------------------------------------------------------------------------------------ */
const files = new Map(Object.entries(mockdata.json).map(([name, content]) => [`${DATA_ROOT}/${name}.json`, JSON.stringify(content)]));
const modules = new Map(Object.entries(mockdata.js).map(([name, module]) => [`${DATA_ROOT}/${name}.js`, module]));
const normalize = (filePath) => String(filePath).replace(/\\/g, '/');

class MemoryFileLoader {
    isTypescriptEnabled() {
        return false;
    }
    syncSupported() {
        return true;
    }
    existsSync(filePath) {
        const key = normalize(filePath);
        return files.has(key) || modules.has(key);
    }
    async exists(filePath) {
        return this.existsSync(filePath);
    }
    loadFileSync(filePath) {
        const key = normalize(filePath);
        if (!files.has(key)) {
            throw new Error(`File not found in the browser mock data: ${key}`);
        }
        return files.get(key);
    }
    async loadFile(filePath) {
        return this.loadFileSync(filePath);
    }
    async loadJS(filePath) {
        const key = normalize(filePath);
        if (!modules.has(key)) {
            throw new Error(`Module not found in the browser mock data: ${key}`);
        }
        return modules.get(key);
    }
}

/* ------------------------------------------------------------------------------------------------ */
/* Service                                                                                           */
/* ------------------------------------------------------------------------------------------------ */
const serviceConfig = {
    urlPath: SERVICE_URL.replace(/\/$/, ''),
    _internalName: '0001',
    metadataPath: '/metadata.xml',
    mockdataPath: DATA_ROOT,
    generateMockData: false,
    noETag: true,
    watch: false,
    debug: false,
    logRequests: false,
    logResponses: false,
    strictKeyMode: false,
    contextBasedIsolation: false,
    validateETag: false
};

const ready = (async () => {
    const metadata = await ODataMetadata.parse(mockdata.metadata, serviceConfig.urlPath);
    const registry = {
        getService: () => dataAccess,
        getServicesWithAliases: () => [serviceConfig.urlPath]
    };
    const dataAccess = new DataAccess(serviceConfig, metadata, new MemoryFileLoader(), undefined, registry);
    return { dataAccess, metadata, batch: batchRouter(dataAccess) };
})();

const NO_CACHE = { 'cache-control': 'private, no-cache, no-store, must-revalidate', expires: '-1', pragma: 'no-cache' };

/**
 * Handles one HTTP request to the mock service.
 *
 * @param {object} request request
 * @param {string} request.method HTTP method
 * @param {string} request.path path relative to the service root, e.g. "$batch" or "TestCase?$top=10"
 * @param {object} request.headers request headers (lower-case names)
 * @param {string} [request.body] request body
 * @returns {Promise<{status: number, headers: object, body: string}>} response
 */
async function handle({ method, path, headers, body }) {
    const { dataAccess, metadata, batch } = await ready;
    const [pathname] = path.split('?');
    const responseHeaders = { ...NO_CACHE, 'odata-version': '4.0' };
    if (headers['x-csrf-token'] === 'Fetch') {
        responseHeaders['x-csrf-token'] = 'MOCK-0504-71383';
    }
    if (pathname === '$metadata') {
        return { status: 200, headers: { ...responseHeaders, 'content-type': 'application/xml' }, body: metadata.getEdmx() };
    }
    if (pathname === '' && (method === 'HEAD' || method === 'GET')) {
        const value = metadata.getEntitySets().map((entitySet) => ({ name: entitySet.name, kind: 'EntitySet', url: entitySet.name }));
        return {
            status: 200,
            headers: { ...responseHeaders, 'content-type': 'application/json' },
            body: method === 'HEAD' ? '' : JSON.stringify({ '@odata.context': '$metadata', value })
        };
    }
    let parsedBody = body || '{}';
    if ((headers['content-type'] || '').includes('application/json')) {
        try {
            parsedBody = JSON.parse(body || '{}');
        } catch (e) {
            return { status: 400, headers: responseHeaders, body: 'Error parsing request body' };
        }
    }
    if (pathname === '$batch') {
        return new Promise((resolve) => {
            const chunks = [];
            const res = {
                statusCode: 200,
                headersSent: false,
                _headers: {},
                setHeader(name, value) {
                    this._headers[String(name).toLowerCase()] = value;
                },
                getHeader(name) {
                    return this._headers[String(name).toLowerCase()];
                },
                write(chunk) {
                    chunks.push(String(chunk));
                },
                end(chunk) {
                    if (chunk) {
                        chunks.push(String(chunk));
                    }
                    resolve({ status: this.statusCode, headers: { ...responseHeaders, ...this._headers }, body: chunks.join('') });
                }
            };
            const req = { method, url: `/${path}`, originalUrl: `/${path}`, headers, body: parsedBody, tenantId: 'tenant-default' };
            batch(req, res, (error) => resolve({ status: 500, headers: responseHeaders, body: String(error && error.message ? error.message : error) }));
        });
    }
    const request = new ODataRequest({ url: `/${path}`, tenantId: 'tenant-default', body: parsedBody, headers, method }, dataAccess);
    await request.handleRequest();
    const responseBody = request.getResponseData();
    return {
        status: request.statusCode,
        headers: { ...responseHeaders, ...request.responseHeaders, ...request.globalResponseHeaders },
        body: responseBody === undefined || responseBody === null ? '' : String(responseBody)
    };
}

/* ------------------------------------------------------------------------------------------------ */
/* XMLHttpRequest interceptor                                                                        */
/* ------------------------------------------------------------------------------------------------ */
const NativeOpen = XMLHttpRequest.prototype.open;
const NativeSend = XMLHttpRequest.prototype.send;
const NativeSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
const NativeAbort = XMLHttpRequest.prototype.abort;

function servicePath(url) {
    const absolute = new URL(url, document.baseURI);
    const index = absolute.pathname.indexOf(SERVICE_URL);
    return index === -1 ? undefined : absolute.pathname.slice(index + SERVICE_URL.length) + absolute.search;
}

function define(xhr, name, value) {
    Object.defineProperty(xhr, name, { value, configurable: true, writable: true });
}

XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const path = servicePath(url);
    if (path === undefined) {
        this.__zstcMock = undefined;
        return NativeOpen.call(this, method, url, ...rest);
    }
    this.__zstcMock = { method: String(method).toUpperCase(), path, headers: {}, aborted: false };
    define(this, 'readyState', 1);
    this.dispatchEvent(new Event('readystatechange'));
    return undefined;
};

XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (!this.__zstcMock) {
        return NativeSetRequestHeader.call(this, name, value);
    }
    this.__zstcMock.headers[String(name).toLowerCase()] = String(value);
    return undefined;
};

XMLHttpRequest.prototype.abort = function () {
    if (!this.__zstcMock) {
        return NativeAbort.call(this);
    }
    this.__zstcMock.aborted = true;
    return undefined;
};

XMLHttpRequest.prototype.send = function (body) {
    const mock = this.__zstcMock;
    if (!mock) {
        return NativeSend.call(this, body);
    }
    const xhr = this;
    handle({ method: mock.method, path: mock.path, headers: mock.headers, body: typeof body === 'string' ? body : body ? String(body) : '' })
        .catch((error) => ({ status: 500, headers: {}, body: String(error && error.stack ? error.stack : error) }))
        .then((response) => {
            if (mock.aborted) {
                return;
            }
            const headers = Object.fromEntries(Object.entries(response.headers).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k.toLowerCase(), String(v)]));
            define(xhr, 'status', response.status);
            define(xhr, 'statusText', String(response.status));
            define(xhr, 'responseText', response.body);
            define(xhr, 'response', response.body);
            define(xhr, 'responseURL', new URL(SERVICE_URL + mock.path, document.baseURI).href);
            define(xhr, 'getResponseHeader', (name) => headers[String(name).toLowerCase()] ?? null);
            define(xhr, 'getAllResponseHeaders', () => Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n'));
            define(xhr, 'readyState', 4);
            xhr.dispatchEvent(new Event('readystatechange'));
            xhr.dispatchEvent(new ProgressEvent('load'));
            xhr.dispatchEvent(new ProgressEvent('loadend'));
        });
    return undefined;
};

globalThis.zstcMockServer = { SERVICE_URL, handle, ready };
