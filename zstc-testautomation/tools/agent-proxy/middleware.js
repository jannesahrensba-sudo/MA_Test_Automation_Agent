'use strict';
/**
 * UI5 custom middleware "zstc-agent-proxy" — local development proxy from the service assistant to the Claude API
 * (Messages API, official Anthropic SDK). Registered in ui5-mock.yaml under the mount path /agent-api:
 *
 *   GET  /agent-api/status     → { available: true, model } | { available: false, reason }
 *   POST /agent-api/messages   → one Messages API request: { system, messages, tools, tool_choice } → response
 *
 * The tool-use loop runs in the page (webapp/ext/agent/core/messagesLoop.js) because the tools call the OData service
 * of the app. This proxy only adds what must stay on the server:
 *   ANTHROPIC_API_KEY    API key (or ANTHROPIC_AUTH_TOKEN, as read by the SDK) — never sent to the browser
 *   ANTHROPIC_MODEL      model ID (required; see README)
 *   ANTHROPIC_EFFORT     optional output_config.effort (low | medium | high | xhigh | max)
 *   ANTHROPIC_FALLBACKS  "off" disables the server-side refusal fallback (default: fallbacks "default")
 *   AGENT_PROXY_ALLOW_REMOTE=1  also accept requests that do not come from localhost
 *
 * Only for local demos on test data (prompt.md, rule 2): no credentials in the frontend, no productive data.
 */
const Anthropic = require('@anthropic-ai/sdk');

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
}

function sendError(res, status, type, message) {
    send(res, status, { error: { type, message } });
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('Request body too large'), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
            } catch (error) {
                reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
            }
        });
        req.on('error', reject);
    });
}

/** @returns {{available: boolean, model?: string, reason?: string}} configuration state (no secrets) */
function status() {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
        return {
            available: false,
            reason: 'Claude lokal: Umgebungsvariablen ANTHROPIC_API_KEY und ANTHROPIC_MODEL setzen und npm start neu starten (README, Abschnitt Service-Assistent).'
        };
    }
    if (!process.env.ANTHROPIC_MODEL) {
        return { available: false, reason: 'Claude lokal: Umgebungsvariable ANTHROPIC_MODEL (Modell-ID) setzen und npm start neu starten.' };
    }
    return { available: true, model: process.env.ANTHROPIC_MODEL };
}

/** Only the fields the page may choose; model, max_tokens and everything else are set here */
function requestFromBody(body) {
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        throw Object.assign(new Error('messages must be a non-empty array'), { status: 400 });
    }
    for (const message of body.messages) {
        if (!message || (message.role !== 'user' && message.role !== 'assistant') || (typeof message.content !== 'string' && !Array.isArray(message.content))) {
            throw Object.assign(new Error('each message needs role user|assistant and content'), { status: 400 });
        }
    }
    const request = {
        model: process.env.ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        messages: body.messages,
        // automatic prompt caching of the stable prefix (tools, system prompt, earlier turns)
        cache_control: { type: 'ephemeral' }
    };
    if (typeof body.system === 'string' && body.system) {
        request.system = body.system;
    }
    if (Array.isArray(body.tools) && body.tools.length) {
        request.tools = body.tools.map((tool) => ({ name: String(tool.name), description: String(tool.description || ''), input_schema: tool.input_schema || { type: 'object' } }));
    }
    if (body.tool_choice && (body.tool_choice.type === 'auto' || body.tool_choice.type === 'none')) {
        request.tool_choice = { type: body.tool_choice.type };
    }
    const effort = process.env.ANTHROPIC_EFFORT;
    if (effort && EFFORTS.has(effort)) {
        request.output_config = { effort };
    }
    return request;
}

module.exports = function ({ log }) {
    let client;

    async function createMessage(request) {
        if (!client) {
            // credentials and base URL from the environment (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL)
            client = new Anthropic();
        }
        if (process.env.ANTHROPIC_FALLBACKS === 'off') {
            return client.messages.create(request);
        }
        try {
            // refusal fallback: a declined request is re-run server-side on the recommended fallback model
            return await client.beta.messages.create({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' });
        } catch (error) {
            if (error instanceof Anthropic.BadRequestError && /fallback/i.test(error.message)) {
                log.warn(`Refusal fallback not available for model ${request.model} — request sent without fallbacks (set ANTHROPIC_FALLBACKS=off to skip this attempt).`);
                return client.messages.create(request);
            }
            throw error;
        }
    }

    return async function agentProxy(req, res, next) {
        const path = (req.path || req.url || '').split('?')[0];
        const remote = req.socket?.remoteAddress || '';
        if (!/^(::1|127\.|::ffff:127\.)/.test(remote) && process.env.AGENT_PROXY_ALLOW_REMOTE !== '1') {
            sendError(res, 403, 'forbidden', 'The agent proxy only accepts requests from localhost.');
            return;
        }
        if (req.method === 'GET' && path === '/status') {
            send(res, 200, status());
            return;
        }
        if (req.method !== 'POST' || path !== '/messages') {
            next();
            return;
        }
        const state = status();
        if (!state.available) {
            sendError(res, 503, 'not_configured', state.reason);
            return;
        }
        let request;
        try {
            request = requestFromBody(await readJson(req));
        } catch (error) {
            sendError(res, error.status || 400, 'invalid_request', error.message);
            return;
        }
        try {
            const response = await createMessage(request);
            // the page needs content and stop reason; content blocks are passed back unchanged in the next request
            send(res, 200, {
                id: response.id,
                model: response.model,
                role: response.role,
                content: response.content,
                stop_reason: response.stop_reason,
                stop_details: response.stop_details || null,
                usage: response.usage
            });
        } catch (error) {
            // typed SDK errors, most specific first
            if (error instanceof Anthropic.AuthenticationError) {
                sendError(res, 401, 'authentication_error', 'The Claude API rejected the API key (ANTHROPIC_API_KEY).');
            } else if (error instanceof Anthropic.PermissionDeniedError) {
                sendError(res, 403, 'permission_error', error.message);
            } else if (error instanceof Anthropic.NotFoundError) {
                sendError(res, 404, 'not_found_error', `Model or endpoint not found — check ANTHROPIC_MODEL (${request.model}). ${error.message}`);
            } else if (error instanceof Anthropic.RateLimitError) {
                sendError(res, 429, 'rate_limit_error', 'Rate limit of the Claude API reached — try again later.');
            } else if (error instanceof Anthropic.BadRequestError) {
                sendError(res, 400, 'invalid_request_error', error.message);
            } else if (error instanceof Anthropic.APIConnectionError) {
                sendError(res, 502, 'connection_error', 'The Claude API is not reachable from the local server (network or proxy settings).');
            } else if (error instanceof Anthropic.APIError) {
                sendError(res, error.status || 502, 'api_error', error.message);
            } else {
                log.error(error);
                sendError(res, 500, 'proxy_error', error.message || String(error));
            }
        }
    };
};

module.exports.status = status;
module.exports.requestFromBody = requestFromBody;
