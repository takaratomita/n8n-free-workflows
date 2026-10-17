import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCode, runCode } from './n8n-code-harness.mjs';

const triage = loadCode('03-contact-form-triage', 'validate-and-score.js');

const cfg = (over = {}) => ({
  siteName: 'Acme Widgets',
  teamEmail: 'team@example.com',
  spamThreshold: 5,
  blockedDomains: 'mailinator.com, yopmail.com',
  blockedWords: 'casino, backlinks, seo services',
  maxLinks: 2,
  ...over,
});

const body = (over = {}) => ({
  name: 'Ada Lovelace',
  email: 'ada@example.org',
  message: 'Hi! I would like a quote for 200 widgets delivered in November.',
  ...over,
});

async function run(b, config = cfg()) {
  const [out] = await runCode(triage, { nodes: { Config: [config], Webhook: [{ body: b, headers: {} }] } });
  return out;
}

test('a normal message is ok and produces a team email', async () => {
  const out = await run(body());
  assert.equal(out.status, 'ok');
  assert.match(out.ticketId, /^[A-Z0-9]{8}$/);
  assert.equal(out.to, 'team@example.com');
  assert.match(out.subject, /Acme Widgets/);
  assert.match(out.text, /200 widgets/);
  assert.equal(out.replyTo, 'ada@example.org');
});

test('missing or invalid fields are reported as invalid', async () => {
  const out = await run(body({ email: 'not-an-email', message: 'short', name: '' }));
  assert.equal(out.status, 'invalid');
  assert.equal(out.errors.length, 3);
});

test('honeypot field marks spam', async () => {
  const out = await run(body({ hp_url: 'http://spam.example.com' }));
  assert.equal(out.status, 'spam');
  assert.ok(out.reasons.some((r) => /honeypot/.test(r)));
});

test('an autofilled "website" field is not treated as the honeypot', async () => {
  const out = await run(body({ website: 'https://ada.example.org' }));
  assert.equal(out.status, 'ok');
});

test('display names, quotes and address lists are rejected as email', async () => {
  for (const email of ['"x"<a@b.cc>', 'Ada <ada@example.org>', 'a@example.org,b@example.org', 'a@b', 'a@@example.org']) {
    const out = await run(body({ email }));
    assert.equal(out.status, 'invalid', email);
  }
  assert.equal((await run(body({ email: "o'neil+forms@mail.example.co.uk" }))).status, 'ok');
});

test('ZWJ/ZWNJ are kept while invisible bidi controls are removed', async () => {
  const zwnj = String.fromCodePoint(0x200c);
  const rlo = String.fromCodePoint(0x202e);
  const out = await run(body({ name: `Sa${zwnj}ra${rlo}x` }));
  assert.equal(out.name, `Sa${zwnj}rax`);
});

test('blocked domain and blocked words add up to spam', async () => {
  const out = await run(body({ email: 'x@mailinator.com', message: 'Cheap SEO services and backlinks for your site, act now!' }));
  assert.equal(out.status, 'spam');
  assert.ok(out.score >= 5);
});

test('one blocked word alone is not spam', async () => {
  const out = await run(body({ message: 'Do you sponsor the local casino night charity event this year?' }));
  assert.equal(out.status, 'ok');
  assert.equal(out.score, 2);
});

test('too many links add to the score', async () => {
  const msg = 'see https://a.example.com https://b.example.com https://c.example.com https://d.example.com';
  const out = await run(body({ message: msg }));
  assert.ok(out.reasons.some((r) => /links/.test(r)));
  assert.equal(out.status, 'spam');
});

test('header injection in name is neutralised in the subject', async () => {
  const out = await run(body({ name: 'Eve\r\nBcc: victim@example.com' }));
  assert.ok(!/[\r\n]/.test(out.subject));
});

test('missing body is invalid, not a crash', async () => {
  const [out] = await runCode(triage, { nodes: { Config: [cfg()], Webhook: [{ headers: {} }] } });
  assert.equal(out.status, 'invalid');
});

test('message length is capped', async () => {
  const out = await run(body({ message: 'a'.repeat(6000) }));
  assert.equal(out.status, 'invalid');
});
