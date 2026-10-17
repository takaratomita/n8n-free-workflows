import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCode, runCode } from './n8n-code-harness.mjs';

const DIR = '02-uptime-monitor';
const splitUrls = loadCode(DIR, 'split-urls.js');
const evaluate = loadCode(DIR, 'evaluate.js');
const saveState = loadCode(DIR, 'save-state.js');

const cfg = (over = {}) => ({
  urls: 'https://example.com\nhttps://example.org/health',
  failuresBeforeAlert: 2,
  timeoutMs: 10000,
  alertTo: 'you@example.com',
  ...over,
});

test('split-urls parses, trims and dedupes http(s) URLs', async () => {
  const out = await runCode(splitUrls, { nodes: { Config: [cfg({ urls: ' https://a.example.com , https://a.example.com\nhttp://b.example.com/x ' })] } });
  assert.deepEqual(out.map((o) => o.url), ['https://a.example.com', 'http://b.example.com/x']);
});

test('split-urls rejects non-http URLs and empty lists', async () => {
  await assert.rejects(runCode(splitUrls, { nodes: { Config: [cfg({ urls: 'ftp://x.example.com' })] } }), /http/);
  await assert.rejects(runCode(splitUrls, { nodes: { Config: [cfg({ urls: '' })] } }), /urls/);
});

const URLS = [{ url: 'https://example.com' }, { url: 'https://example.org/health' }];
const up = { statusCode: 200, body: 'ok' };
const down500 = { statusCode: 503, body: 'x' };
const netErr = { error: { message: 'getaddrinfo ENOTFOUND example.org' } };

function ctx(responses, staticData = {}, config = cfg()) {
  return { input: responses, staticData, nodes: { Config: [config], 'Split URLs': URLS } };
}

test('all up on first run: no alert, state recorded', async () => {
  const [out] = await runCode(evaluate, ctx([up, up]));
  assert.equal(out.hasChanges, false);
  assert.equal(out.newState['https://example.com'].state, 'up');
});

test('one failure below threshold does not alert but counts', async () => {
  const [out] = await runCode(evaluate, ctx([up, down500]));
  assert.equal(out.hasChanges, false);
  assert.equal(out.newState['https://example.org/health'].fails, 1);
  assert.equal(out.newState['https://example.org/health'].state, 'up');
});

test('reaching the threshold alerts DOWN once', async () => {
  const s1 = { uptime: { 'https://example.org/health': { state: 'up', fails: 1, since: null } } };
  const [out] = await runCode(evaluate, ctx([up, netErr], s1));
  assert.equal(out.hasChanges, true);
  assert.match(out.subject, /DOWN/);
  assert.match(out.text, /ENOTFOUND/);
  const st = out.newState['https://example.org/health'];
  assert.equal(st.state, 'down');
  assert.ok(st.since);
  const [again] = await runCode(evaluate, ctx([up, netErr], { uptime: out.newState }));
  assert.equal(again.hasChanges, false, 'still down must not alert again');
});

test('recovery alerts UP with downtime', async () => {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const s = { uptime: { 'https://example.org/health': { state: 'down', fails: 3, since } } };
  const [out] = await runCode(evaluate, ctx([up, up], s));
  assert.equal(out.hasChanges, true);
  assert.match(out.subject, /UP/);
  assert.match(out.text, /down for 15 min/);
  assert.equal(out.newState['https://example.org/health'].state, 'up');
});

test('state of URLs removed from the config is dropped', async () => {
  const s = { uptime: { 'https://gone.example.com': { state: 'down', fails: 9, since: null } } };
  const [out] = await runCode(evaluate, ctx([up, up], s));
  assert.equal(out.newState['https://gone.example.com'], undefined);
});

test('3xx counts as up, 4xx counts as down', async () => {
  const [out] = await runCode(evaluate, ctx([{ statusCode: 301 }, { statusCode: 404 }], {}, cfg({ failuresBeforeAlert: 1 })));
  assert.equal(out.newState['https://example.com'].state, 'up');
  assert.equal(out.newState['https://example.org/health'].state, 'down');
  assert.match(out.text, /HTTP 404/);
});

test('invalid threshold is rejected', async () => {
  await assert.rejects(runCode(evaluate, ctx([up, up], {}, cfg({ failuresBeforeAlert: 0 }))), /failuresBeforeAlert/);
});

test('split-urls caps the list and validates the timeout', async () => {
  const many = Array.from({ length: 21 }, (_, i) => `https://s${i}.example.com`).join('\n');
  await assert.rejects(runCode(splitUrls, { nodes: { Config: [cfg({ urls: many })] } }), /20/);
  await assert.rejects(runCode(splitUrls, { nodes: { Config: [cfg({ timeoutMs: 60000 })] } }), /timeoutMs/);
});

test('downtime is counted from the first failed check', async () => {
  const firstFailAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const s = { uptime: { 'https://example.org/health': { state: 'up', fails: 1, firstFailAt, since: null } } };
  const [down] = await runCode(evaluate, ctx([up, down500], s));
  assert.equal(down.newState['https://example.org/health'].since, firstFailAt);
  const [rec] = await runCode(evaluate, ctx([up, up], { uptime: down.newState }));
  assert.match(rec.text, /down for 10 min/);
});

test('string-shaped error items are handled', async () => {
  const [out] = await runCode(evaluate, ctx([up, { error: 'socket hang up' }], {}, cfg({ failuresBeforeAlert: 1 })));
  assert.match(out.text, /socket hang up/);
});

test('credentials in URLs and error messages never reach the email', async () => {
  const nodes = { Config: [cfg({ failuresBeforeAlert: 1 })], 'Split URLs': [{ url: 'https://admin:pw123@status.example.com/x' }] };
  const [out] = await runCode(evaluate, { input: [{ error: { message: 'connect to https://admin:pw123@status.example.com failed' } }], nodes });
  assert.ok(!out.text.includes('pw123'));
  assert.ok(!out.subject.includes('pw123'));
  assert.ok(!JSON.stringify(out.changes).includes('pw123'));
  assert.ok(!JSON.stringify(out.newState).includes('pw123'), 'saved state must not contain the password');
});

test('save-state stores the evaluated state', async () => {
  const staticData = {};
  await runCode(saveState, { staticData, nodes: { Evaluate: [{ newState: { a: { state: 'up' } } }] } });
  assert.deepEqual(staticData.uptime, { a: { state: 'up' } });
});
