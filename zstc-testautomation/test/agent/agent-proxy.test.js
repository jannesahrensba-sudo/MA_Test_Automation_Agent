'use strict';
/**
 * Local development proxy (tools/agent-proxy/middleware.js): configuration state, request sanitizing and one request
 * through the official SDK against a fake Messages API upstream (no real API key, no network).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_EFFORT', 'ANTHROPIC_FALLBACKS'];
const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
function restoreEnv() {
    for (const name of ENV) {
        if (saved[name] === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = saved[name];
        }
    }
}

const createMiddleware = require('../../tools/agent-proxy/middleware');

function listen(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('status tells what is missing and never exposes the key', (t) => {
    t.after(restoreEnv);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_MODEL;
    assert.equal(createMiddleware.status().available, false);
    assert.match(createMiddleware.status().reason, /ANTHROPIC_API_KEY/);
    process.env.ANTHROPIC_API_KEY = 'secret-test-key';
    assert.match(createMiddleware.status().reason, /ANTHROPIC_MODEL/);
    process.env.ANTHROPIC_MODEL = 'test-model';
    assert.deepEqual(createMiddleware.status(), { available: true, model: 'test-model' });
    assert.doesNotMatch(JSON.stringify(createMiddleware.status()), /secret/);
});

test('requests are sanitized: model and limits are set by the server, unknown fields are dropped', (t) => {
    t.after(restoreEnv);
    process.env.ANTHROPIC_MODEL = 'test-model';
    process.env.ANTHROPIC_EFFORT = 'low';
    const request = createMiddleware.requestFromBody({
        model: 'other-model',
        max_tokens: 999999,
        system: 'sys',
        messages: [{ role: 'user', content: 'Hallo' }],
        tools: [{ name: 'stammdaten_suchen', description: 'd', input_schema: { type: 'object' }, execute: 'x' }],
        tool_choice: { type: 'any' },
        metadata: { user_id: 'x' }
    });
    assert.equal(request.model, 'test-model');
    assert.equal(request.max_tokens, 16000);
    assert.equal(request.tool_choice, undefined);
    assert.equal(request.metadata, undefined);
    assert.deepEqual(request.tools, [{ name: 'stammdaten_suchen', description: 'd', input_schema: { type: 'object' } }]);
    assert.deepEqual(request.output_config, { effort: 'low' });
    assert.deepEqual(request.cache_control, { type: 'ephemeral' });
    assert.throws(() => createMiddleware.requestFromBody({ messages: [{ role: 'system', content: 'x' }] }), /role user\|assistant/);
    assert.throws(() => createMiddleware.requestFromBody({}), /non-empty array/);
});

test('one round through the SDK: API key header, refusal-fallback beta, response passed through', async (t) => {
    const seen = [];
    const upstream = await listen((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            seen.push({ url: req.url, key: req.headers['x-api-key'], beta: req.headers['anthropic-beta'], body: JSON.parse(body) });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
                JSON.stringify({
                    id: 'msg_test',
                    type: 'message',
                    role: 'assistant',
                    model: 'test-model',
                    content: [{ type: 'text', text: 'Hallo zurück' }],
                    stop_reason: 'end_turn',
                    usage: { input_tokens: 1, output_tokens: 1 }
                })
            );
        });
    });
    process.env.ANTHROPIC_API_KEY = 'secret-test-key';
    process.env.ANTHROPIC_MODEL = 'test-model';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;
    delete process.env.ANTHROPIC_FALLBACKS;
    delete process.env.ANTHROPIC_EFFORT;
    const middleware = createMiddleware({ log: { warn() {}, error() {} } });
    const proxy = await listen((req, res) => middleware(req, res, () => {
        res.statusCode = 404;
        res.end();
    }));
    t.after(() => {
        upstream.close();
        proxy.close();
        restoreEnv();
    });
    const base = `http://127.0.0.1:${proxy.address().port}`;
    const status = await (await fetch(`${base}/status`)).json();
    assert.deepEqual(status, { available: true, model: 'test-model' });
    const response = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: 'sys', messages: [{ role: 'user', content: 'Hallo' }] })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.content[0].text, 'Hallo zurück');
    assert.equal(body.stop_reason, 'end_turn');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].key, 'secret-test-key');
    assert.match(seen[0].beta, /server-side-fallback-2026-07-01/);
    assert.equal(seen[0].body.fallbacks, 'default');
    assert.equal(seen[0].body.model, 'test-model');
    assert.equal(seen[0].body.max_tokens, 16000);
    const invalid = await fetch(`${base}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"messages":"x"}' });
    assert.equal(invalid.status, 400);
    assert.equal((await fetch(`${base}/other`)).status, 404);
});
