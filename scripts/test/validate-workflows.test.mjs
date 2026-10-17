import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { validateWorkflow, validateDir } from '../validate-workflows.mjs';
import { ROOT } from './n8n-code-harness.mjs';

function base() {
  return {
    name: 'Valid',
    nodes: [
      { id: 'a', name: 'Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -200], parameters: { content: '## Hi' } },
      { id: 'b', name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
      { id: 'c', name: 'Code', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: { jsCode: 'return $input.all();' } },
    ],
    connections: { 'Manual Trigger': { main: [[{ node: 'Code', type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1' },
  };
}

const has = (errors, re) => errors.some((e) => re.test(e));

test('a valid workflow has no errors', () => {
  assert.deepEqual(validateWorkflow(base()), []);
});

test('missing name / nodes / connections are errors', () => {
  const wf = base();
  delete wf.name;
  delete wf.connections;
  const errors = validateWorkflow(wf);
  assert.ok(has(errors, /name/));
  assert.ok(has(errors, /connections/));
  assert.ok(has(validateWorkflow({ name: 'x', connections: {} }), /nodes/));
});

test('duplicate node names and ids are errors', () => {
  const wf = base();
  wf.nodes[2].name = 'Manual Trigger';
  wf.nodes[2].id = 'b';
  const errors = validateWorkflow(wf);
  assert.ok(has(errors, /duplicate node name/i));
  assert.ok(has(errors, /duplicate node id/i));
});

test('node field types are checked', () => {
  const wf = base();
  wf.nodes[2].typeVersion = '2';
  wf.nodes[2].position = [1];
  wf.nodes[2].type = 'code';
  wf.nodes[2].parameters = null;
  const errors = validateWorkflow(wf);
  assert.ok(has(errors, /typeVersion/));
  assert.ok(has(errors, /position/));
  assert.ok(has(errors, /type/));
  assert.ok(has(errors, /parameters/));
});

test('connections must reference existing nodes', () => {
  const wf = base();
  wf.connections['Manual Trigger'].main[0][0].node = 'Ghost';
  wf.connections.Nope = { main: [[]] };
  const errors = validateWorkflow(wf);
  assert.ok(has(errors, /Ghost/));
  assert.ok(has(errors, /Nope/));
});

test('connection entries need a numeric index', () => {
  const wf = base();
  wf.connections['Manual Trigger'].main[0][0].index = '0';
  assert.ok(has(validateWorkflow(wf), /index/));
});

test('a workflow needs a trigger', () => {
  const wf = base();
  wf.nodes.splice(1, 1);
  wf.connections = {};
  assert.ok(has(validateWorkflow(wf), /trigger/i));
});

test('unconnected non-sticky nodes are errors', () => {
  const wf = base();
  wf.nodes.push({ id: 'd', name: 'Orphan', type: 'n8n-nodes-base.code', typeVersion: 2, position: [400, 0], parameters: { jsCode: 'return [];' } });
  assert.ok(has(validateWorkflow(wf), /Orphan/));
});

test('code node syntax errors are reported', () => {
  const wf = base();
  wf.nodes[2].parameters.jsCode = 'return [;';
  assert.ok(has(validateWorkflow(wf), /syntax/i));
});

test('n8n-preflight findings (strict, template) are errors', () => {
  const wf = base();
  wf.nodes[2].credentials = { smtp: { id: 'abc123', name: 'My SMTP' } };
  assert.ok(has(validateWorkflow(wf), /credential-reference/));
  const noNote = base();
  noNote.nodes.shift();
  assert.ok(has(validateWorkflow(noNote), /no-sticky-note/));
});

test("$('Node') references must name existing nodes (code and expressions)", () => {
  const wf = base();
  wf.nodes[2].parameters.jsCode = "const c = $('Config').first().json; return [];";
  assert.ok(has(validateWorkflow(wf), /Config/));
  const wf2 = base();
  wf2.nodes[2].parameters.note = "={{ $('Ghost Node').first().json.x }}";
  assert.ok(has(validateWorkflow(wf2), /Ghost Node/));
  const wf3 = base();
  wf3.nodes[2].parameters.note = '={{ $node["Old Name"].json.x }}';
  assert.ok(has(validateWorkflow(wf3), /Old Name/));
  const ok = base();
  ok.nodes[2].parameters.jsCode = "const t = $('Manual Trigger').first(); return [];";
  assert.deepEqual(validateWorkflow(ok), []);
});

test('the validator CLI works when started through a symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-link-'));
  try {
    symlinkSync(join(ROOT, 'scripts'), join(dir, 'scripts'));
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'validate-workflows.mjs'), join(ROOT, 'workflows')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /3\/3 workflows passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateDir checks every workflow.json and requires a README.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-validate-'));
  try {
    mkdirSync(join(dir, 'ok'));
    writeFileSync(join(dir, 'ok', 'workflow.json'), JSON.stringify(base()));
    writeFileSync(join(dir, 'ok', 'README.md'), '# ok');
    mkdirSync(join(dir, 'bad'));
    writeFileSync(join(dir, 'bad', 'workflow.json'), '{ broken');
    const result = validateDir(dir);
    assert.equal(result.files, 2);
    assert.deepEqual(result.problems.ok ?? [], []);
    assert.ok(has(result.problems.bad, /JSON/));
    assert.ok(has(result.problems.bad, /README/));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateDir reports an empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-validate-empty-'));
  try {
    assert.equal(validateDir(dir).files, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
