#!/usr/bin/env node
// Structural check for the n8n workflows in workflows/<name>/workflow.json.
//
// Usage: node scripts/validate-workflows.mjs [dir=workflows]
// Exit code: 0 = all good, 1 = problems found or nothing to check.
//
// Checks (per workflow):
//   - valid JSON with name (string), nodes (non-empty array), connections (object)
//   - every node has a unique id and name, a namespaced type, numeric typeVersion,
//     [x, y] position and a parameters object
//   - connections only reference existing nodes and carry {node, type, index:int}
//   - at least one trigger node; every non-sticky node is connected
//   - Code node jsCode parses (syntax only, nothing is executed)
//   - n8n-preflight finds nothing with --template --strict (no secrets, no credential
//     IDs, no pinned data, sticky notes present, ...)
//   - $('Node Name') references in Code nodes and expressions point at existing nodes
//   - the workflow directory has a README.md
// This does not prove n8n can import the file; scripts/n8n-import-check.sh does that
// against a real n8n in Docker.

import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanWorkflow } from '../tools/n8n-preflight/src/scan.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TYPE_RE = /^(?:n8n-nodes-base|@n8n\/n8n-nodes-langchain)\.[A-Za-z0-9]+$/;

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isTrigger = (type) => /trigger$/i.test(type) || type === 'n8n-nodes-base.webhook';

export function validateWorkflow(wf) {
  const errors = [];
  if (!isObj(wf)) return ['workflow must be a JSON object'];
  if (typeof wf.name !== 'string' || !wf.name.trim()) errors.push('workflow name is missing');
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) {
    errors.push('nodes must be a non-empty array');
    return errors;
  }
  if (!isObj(wf.connections)) errors.push('connections must be an object');

  const names = new Set();
  const ids = new Set();
  wf.nodes.forEach((n, i) => {
    const label = `nodes[${i}]${n && typeof n.name === 'string' ? ` "${n.name}"` : ''}`;
    if (!isObj(n)) {
      errors.push(`${label}: node must be an object`);
      return;
    }
    if (typeof n.name !== 'string' || !n.name) errors.push(`${label}: name is missing`);
    else if (names.has(n.name)) errors.push(`${label}: duplicate node name`);
    else names.add(n.name);
    if (typeof n.id !== 'string' || !n.id) errors.push(`${label}: id is missing`);
    else if (ids.has(n.id)) errors.push(`${label}: duplicate node id`);
    else ids.add(n.id);
    if (typeof n.type !== 'string' || !TYPE_RE.test(n.type)) errors.push(`${label}: type must be namespaced (e.g. n8n-nodes-base.code)`);
    if (typeof n.typeVersion !== 'number' || !(n.typeVersion > 0)) errors.push(`${label}: typeVersion must be a positive number`);
    if (!Array.isArray(n.position) || n.position.length !== 2 || !n.position.every(Number.isFinite)) {
      errors.push(`${label}: position must be [x, y]`);
    }
    if (!isObj(n.parameters)) errors.push(`${label}: parameters must be an object`);
    if (n.type === 'n8n-nodes-base.code' && isObj(n.parameters) && typeof n.parameters.jsCode === 'string') {
      try {
        new AsyncFunction(n.parameters.jsCode);
      } catch (e) {
        errors.push(`${label}: jsCode syntax error (${e.message})`);
      }
    }
  });

  const connected = new Set();
  if (isObj(wf.connections)) {
    for (const [source, outputs] of Object.entries(wf.connections)) {
      if (!names.has(source)) errors.push(`connections: source "${source}" is not a node`);
      if (!isObj(outputs)) {
        errors.push(`connections["${source}"] must be an object`);
        continue;
      }
      for (const [outType, branches] of Object.entries(outputs)) {
        if (!Array.isArray(branches)) {
          errors.push(`connections["${source}"].${outType} must be an array`);
          continue;
        }
        branches.forEach((branch, b) => {
          if (branch === null) return;
          if (!Array.isArray(branch)) {
            errors.push(`connections["${source}"].${outType}[${b}] must be an array`);
            return;
          }
          branch.forEach((c, k) => {
            const at = `connections["${source}"].${outType}[${b}][${k}]`;
            if (!isObj(c) || typeof c.node !== 'string') {
              errors.push(`${at}: node is missing`);
              return;
            }
            if (!names.has(c.node)) errors.push(`${at}: target "${c.node}" is not a node`);
            if (typeof c.type !== 'string') errors.push(`${at}: type is missing`);
            if (!Number.isInteger(c.index) || c.index < 0) errors.push(`${at}: index must be a non-negative integer`);
            connected.add(source);
            connected.add(c.node);
          });
        });
      }
    }
  }

  const working = wf.nodes.filter((n) => isObj(n) && n.type !== 'n8n-nodes-base.stickyNote');
  if (!working.some((n) => typeof n.type === 'string' && isTrigger(n.type))) errors.push('workflow has no trigger node');
  if (working.length > 1) {
    for (const n of working) {
      if (typeof n.name === 'string' && !connected.has(n.name)) errors.push(`node "${n.name}" is not connected`);
    }
  }

  // $('Node Name') in Code nodes and expressions must point at a real node (renames break silently otherwise).
  // Both $('Name') and the older $node["Name"] / $node['Name'] forms.
  const refRes = [/\$\(\s*(['"])((?:(?!\1).){1,200})\1\s*\)/g, /\$node\[\s*(['"])((?:(?!\1).){1,200})\1\s*\]/g];
  const checkRefs = (value, where) => {
    if (typeof value === 'string') {
      for (const re of refRes) {
        for (const m of value.matchAll(re)) {
          if (!names.has(m[2])) errors.push(`${where}: reference to node "${m[2]}" does not match any node name`);
        }
      }
    } else if (Array.isArray(value)) value.forEach((v) => checkRefs(v, where));
    else if (isObj(value)) Object.values(value).forEach((v) => checkRefs(v, where));
  };
  for (const n of wf.nodes) {
    if (isObj(n) && n.type !== 'n8n-nodes-base.stickyNote') checkRefs(n.parameters, `node "${n.name}"`);
  }

  for (const f of scanWorkflow(wf, { template: true })) {
    errors.push(`n8n-preflight ${f.severity} ${f.rule}: ${f.message} at ${f.node ? `"${f.node}" ` : ''}${f.path}`);
  }
  return errors;
}

export function validateDir(dir) {
  const problems = {};
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const wfPath = join(dir, entry.name, 'workflow.json');
    if (!existsSync(wfPath)) continue;
    files += 1;
    const errs = [];
    try {
      errs.push(...validateWorkflow(JSON.parse(readFileSync(wfPath, 'utf8'))));
    } catch (e) {
      errs.push(`invalid JSON (${e.message})`);
    }
    if (!existsSync(join(dir, entry.name, 'README.md'))) errs.push('README.md is missing');
    problems[entry.name] = errs;
  }
  return { files, problems };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = resolve(process.argv[2] ?? join(root, 'workflows'));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`${dir}: not a directory`);
    return 1;
  }
  const { files, problems } = validateDir(dir);
  if (files === 0) {
    console.error(`${dir}: no workflow.json found`);
    return 1;
  }
  let bad = 0;
  for (const [name, errs] of Object.entries(problems)) {
    if (errs.length === 0) {
      console.log(`OK   ${name}`);
      continue;
    }
    bad += 1;
    console.log(`FAIL ${name}`);
    for (const e of errs) console.log(`     - ${e}`);
  }
  console.log(`\n${files - bad}/${files} workflows passed.`);
  return bad ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
