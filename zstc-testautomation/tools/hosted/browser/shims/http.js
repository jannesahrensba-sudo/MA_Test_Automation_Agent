'use strict';
// http shim: status texts for the $batch response parts
const STATUS_CODES = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized',
    403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 412: 'Precondition Failed', 428: 'Precondition Required',
    500: 'Internal Server Error', 501: 'Not Implemented', 503: 'Service Unavailable'
};
module.exports = { STATUS_CODES };
