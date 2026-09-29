'use strict';
/**
 * Adapter between the FE mock server data contributors (webapp/localService/mainService/data/<EntitySet>.js) and the
 * mock backend services. It keeps the contributors thin:
 *   - creates a repository on the mock server entity interfaces for the current request,
 *   - turns MockServiceError into an OData V4 error response (RAP-like: code, message, target, severity),
 *   - adds transition messages to the sap-messages response header.
 *
 * On the real system this layer does not exist: the RAP runtime does all of it for the behavior implementation.
 */
const { createMockServerRepository } = require('./repository');
const { MockServiceError } = require('../common/messages');

const DRAFT_ACTIONS = new Set(['Edit', 'Activate', 'Discard', 'Prepare']);

/** sap-messages travels as an HTTP header: keep the texts Latin-1 */
function headerSafe(text) {
    return String(text ?? '')
        .replace(/[–—]/g, '-')
        .replace(/→/g, '->')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[^\x20-\xFF]/g, ' ');
}

/**
 * @param {object} odataRequest current ODataRequest
 * @param {object[]} messages SAP__Message records (transition messages)
 */
function addMessages(odataRequest, messages = []) {
    for (const message of messages) {
        odataRequest.addCustomMessage({ ...message, message: headerSafe(message.message) });
    }
}

/**
 * Runs service logic with a repository for the current request and maps service errors to OData errors.
 *
 * @param {object} contributor data contributor (this) with base and throwError
 * @param {object} odataRequest current ODataRequest
 * @param {Function} fn async (repo) => result
 * @param {object} [options] options
 * @param {boolean} [options.boundAction] errors belong to a bound action: targets are relative to the binding parameter _it
 * @returns {Promise<*>} result of fn
 */
async function run(contributor, odataRequest, fn, { boundAction = false } = {}) {
    const repo = createMockServerRepository(contributor.base, odataRequest);
    try {
        return await fn(repo);
    } catch (error) {
        if (error instanceof MockServiceError) {
            if (boundAction && error.target && !error.target.startsWith('_it/')) {
                error.target = `_it/${error.target}`;
            }
            const body = error.toODataError();
            body.error.message = headerSafe(body.error.message);
            contributor.throwError(body.error.message, error.statusCode, body, false);
        }
        throw error;
    }
}

/**
 * Overwrites derived properties in read results with freshly derived values (only properties that are part of the
 * response, so $select is respected).
 *
 * @param {object|object[]} data read result
 * @param {Function} deriveFor async (row) => derived fields or undefined
 * @returns {Promise<object|object[]>} data
 */
async function applyDerived(data, deriveFor) {
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
        if (!row || typeof row !== 'object') {
            continue;
        }
        const derived = await deriveFor(row);
        if (!derived) {
            continue;
        }
        for (const [key, value] of Object.entries(derived)) {
            if (Object.prototype.hasOwnProperty.call(row, key)) {
                row[key] = value;
            }
        }
    }
    return data;
}

/**
 * Copies the stored values of the given entity into a (cloned) response object, e.g. after a draft action whose
 * response was read before the behavior implementation changed the entity.
 *
 * @param {object} response response object
 * @param {object} stored stored entity
 * @returns {object} response
 */
function refreshResponse(response, stored) {
    if (response && stored) {
        for (const key of Object.keys(response)) {
            if (Object.prototype.hasOwnProperty.call(stored, key) && key !== 'Processed') {
                response[key] = stored[key];
            }
        }
    }
    return response;
}

module.exports = { DRAFT_ACTIONS, headerSafe, addMessages, run, applyDerived, refreshResponse };
