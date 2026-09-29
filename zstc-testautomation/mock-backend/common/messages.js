'use strict';
/**
 * SAP-conformant messages (SAP__Message format of RAP V4 services) with the project message categories.
 *
 * Code format "<message class>/<number>" like RAP: message class ZSTC_TA (project proposal).
 * Number ranges encode the category:
 *   100-199 VALIDATION_ERROR · 200-299 BUSINESS_ERROR · 300-399 AUTHORIZATION_ERROR
 *   400-499 EXECUTION_ERROR  · 500-599 TECHNICAL_ERROR  · 900-999 information / success
 */

const MESSAGE_CLASS = 'ZSTC_TA';

const CATEGORY = Object.freeze({
    VALIDATION_ERROR: { name: 'VALIDATION_ERROR', httpStatus: 400 },
    BUSINESS_ERROR: { name: 'BUSINESS_ERROR', httpStatus: 400 },
    AUTHORIZATION_ERROR: { name: 'AUTHORIZATION_ERROR', httpStatus: 403 },
    EXECUTION_ERROR: { name: 'EXECUTION_ERROR', httpStatus: 409 },
    TECHNICAL_ERROR: { name: 'TECHNICAL_ERROR', httpStatus: 503 },
    INFO: { name: 'INFO', httpStatus: 200 }
});

/** numericSeverity of SAP__Message: 1 success, 2 info, 3 warning, 4 error */
const SEVERITY = Object.freeze({ SUCCESS: 1, INFO: 2, WARNING: 3, ERROR: 4 });

/**
 * Creates a SAP__Message record.
 *
 * @param {number} number message number within ZSTC_TA
 * @param {string} text message text
 * @param {object} [options] options
 * @param {number} [options.severity] numeric severity (default error)
 * @param {string} [options.target] target path relative to the entity carrying SAP__Messages
 * @param {boolean} [options.transition] transition (true) or state (false) message
 * @returns {object} SAP__Message
 */
function sapMessage(number, text, { severity = SEVERITY.ERROR, target = null, transition = true } = {}) {
    return {
        code: `${MESSAGE_CLASS}/${number}`,
        message: text,
        target,
        additionalTargets: [],
        transition,
        numericSeverity: severity,
        longtextUrl: null
    };
}

/** Error that the thin mock server handlers turn into an OData V4 error response. */
class MockServiceError extends Error {
    /**
     * @param {object} category entry of CATEGORY
     * @param {number} number message number
     * @param {string} text message text
     * @param {string} [target] optional target
     */
    constructor(category, number, text, target) {
        super(text);
        this.category = category;
        this.number = number;
        this.target = target;
        this.statusCode = category.httpStatus;
    }

    /** @returns {object} OData V4 JSON error body */
    toODataError() {
        return {
            error: {
                code: `${MESSAGE_CLASS}/${this.number}`,
                message: this.message,
                target: this.target || undefined,
                details: [],
                '@SAP__common.numericSeverity': SEVERITY.ERROR,
                // project-specific marker so testers can see the message category in the response
                '@ZSTC.category': this.category.name
            }
        };
    }
}

module.exports = { MESSAGE_CLASS, CATEGORY, SEVERITY, sapMessage, MockServiceError };
