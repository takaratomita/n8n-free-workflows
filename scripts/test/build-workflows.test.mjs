import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { buildAll } from '../build-workflows.mjs';
import { validateDir } from '../validate-workflows.mjs';
import { ROOT } from './n8n-code-harness.mjs';

test('there are exactly three shipped workflows', async () => {
  const built = await buildAll();
  assert.equal(built.length, 3);
});

test('committed workflow.json files match their sources', async () => {
  for (const b of await buildAll()) {
    assert.ok(existsSync(b.path), `${b.name}/workflow.json is missing`);
    assert.equal(readFileSync(b.path, 'utf8'), b.json, `${b.name}/workflow.json is stale`);
  }
});

test('every code/*.js file is embedded verbatim in its workflow', async () => {
  for (const b of await buildAll()) {
    const wf = JSON.parse(b.json);
    const codes = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code').map((n) => n.parameters.jsCode);
    const files = readdirSync(join(ROOT, 'workflows', b.name, 'code')).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 1, `${b.name} has no code files`);
    assert.equal(codes.length, files.length, `${b.name}: every Code node comes from a code/*.js file`);
    for (const f of files) {
      const src = readFileSync(join(ROOT, 'workflows', b.name, 'code', f), 'utf8');
      assert.ok(codes.includes(src), `${b.name}/code/${f} is not embedded verbatim`);
    }
  }
});

test('the shipped workflows pass the structural validator', () => {
  const { files, problems } = validateDir(join(ROOT, 'workflows'));
  assert.equal(files, 3);
  for (const [name, errs] of Object.entries(problems)) assert.deepEqual(errs, [], name);
});
