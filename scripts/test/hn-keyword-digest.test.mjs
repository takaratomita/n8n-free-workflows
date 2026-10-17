import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCode, runCode } from './n8n-code-harness.mjs';

const DIR = '01-hn-keyword-digest';
const buildQueries = loadCode(DIR, 'build-queries.js');
const pickNew = loadCode(DIR, 'pick-new-stories.js');
const saveSeen = loadCode(DIR, 'save-seen.js');

const cfg = (over = {}) => ({
  keywords: 'n8n, self-hosted\nopen source automation',
  lookbackHours: 24,
  minPoints: 3,
  maxPerKeyword: 20,
  alertTo: 'you@example.com',
  ...over,
});

const hit = (id, points, extra = {}) => ({
  objectID: String(id),
  title: `Story ${id}`,
  url: `https://blog.example.com/${id}`,
  points,
  num_comments: 4,
  author: 'pg',
  created_at: '2026-10-09T00:00:00Z',
  ...extra,
});

test('build-queries splits keywords on commas and newlines and computes the window', async () => {
  const before = Math.floor(Date.now() / 1000);
  const out = await runCode(buildQueries, { nodes: { Config: [cfg()] } });
  assert.deepEqual(out.map((o) => o.keyword), ['n8n', 'self-hosted', 'open source automation']);
  assert.ok(Math.abs(out[0].since - (before - 24 * 3600)) <= 2);
  assert.equal(out[0].hitsPerPage, 20);
});

test('build-queries dedupes keywords case-insensitively', async () => {
  const out = await runCode(buildQueries, { nodes: { Config: [cfg({ keywords: 'n8n, N8N ,  , zapier' })] } });
  assert.deepEqual(out.map((o) => o.keyword), ['n8n', 'zapier']);
});

test('build-queries rejects empty keywords and bad lookback', async () => {
  await assert.rejects(runCode(buildQueries, { nodes: { Config: [cfg({ keywords: ' , ' })] } }), /keywords/);
  await assert.rejects(runCode(buildQueries, { nodes: { Config: [cfg({ lookbackHours: 0 })] } }), /lookbackHours/);
  await assert.rejects(runCode(buildQueries, { nodes: { Config: [cfg({ lookbackHours: 'abc' })] } }), /lookbackHours/);
});

function pickCtx({ responses, staticData = {}, config = cfg() }) {
  return {
    input: responses,
    staticData,
    nodes: {
      Config: [config],
      'Build Queries': [{ keyword: 'n8n' }, { keyword: 'self-hosted' }].slice(0, responses.length),
    },
  };
}

test('pick-new-stories filters by points, merges keywords and sorts by points', async () => {
  const [out] = await runCode(
    pickNew,
    pickCtx({ responses: [{ hits: [hit(1, 10), hit(2, 1), hit(3, 50)] }, { hits: [hit(1, 10), hit(4, 5)] }] }),
  );
  assert.equal(out.hasNew, true);
  assert.equal(out.count, 3);
  assert.deepEqual(out.stories.map((s) => s.id), ['3', '1', '4']);
  assert.deepEqual(out.stories.find((s) => s.id === '1').keywords, ['n8n', 'self-hosted']);
  assert.match(out.subject, /3 new/);
  assert.match(out.text, /Story 3/);
  assert.match(out.text, /news\.ycombinator\.com\/item\?id=3/);
  assert.equal(out.to, 'you@example.com');
});

test('pick-new-stories skips stories already sent', async () => {
  const [out] = await runCode(pickNew, pickCtx({ responses: [{ hits: [hit(1, 10), hit(5, 10)] }], staticData: { hnSeen: ['1'] } }));
  assert.deepEqual(out.stories.map((s) => s.id), ['5']);
  assert.deepEqual(out.newSeen, ['1', '5']);
});

test('pick-new-stories reports nothing new without failing', async () => {
  const [out] = await runCode(pickNew, pickCtx({ responses: [{ hits: [] }] }));
  assert.equal(out.hasNew, false);
  assert.equal(out.count, 0);
});

test('pick-new-stories notes a failed keyword but still sends the rest', async () => {
  const [out] = await runCode(pickNew, pickCtx({ responses: [{ error: { message: 'timeout' } }, { hits: [hit(9, 9)] }] }));
  assert.equal(out.count, 1);
  assert.match(out.text, /could not be searched: n8n/);
});

test('pick-new-stories throws when every search failed', async () => {
  await assert.rejects(runCode(pickNew, pickCtx({ responses: [{ error: 'boom' }] })), /every keyword/);
});

test('pick-new-stories strips control characters and caps long titles', async () => {
  const [out] = await runCode(pickNew, pickCtx({ responses: [{ hits: [hit(7, 9, { title: 'Bad\u0000\nTitle' + 'x'.repeat(500), url: null })] }] }));
  const s = out.stories[0];
  assert.ok(!/[\u0000\n]/.test(s.title));
  assert.ok(s.title.length <= 200);
  assert.equal(s.url, 'https://news.ycombinator.com/item?id=7');
});

test('pick-new-stories caps the seen list', async () => {
  const seen = Array.from({ length: 2000 }, (_, i) => `old-${i}`);
  const [out] = await runCode(pickNew, pickCtx({ responses: [{ hits: [hit('new', 9)] }], staticData: { hnSeen: seen } }));
  assert.equal(out.newSeen.length, 2000);
  assert.equal(out.newSeen.at(-1), 'new');
});

test('save-seen stores the list computed by pick-new-stories', async () => {
  const staticData = {};
  await runCode(saveSeen, { staticData, nodes: { 'Pick New Stories': [{ newSeen: ['a', 'b'] }] } });
  assert.deepEqual(staticData.hnSeen, ['a', 'b']);
});
