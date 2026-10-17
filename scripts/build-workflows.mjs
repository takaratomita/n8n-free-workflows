#!/usr/bin/env node
// Build workflows/<name>/workflow.json from workflows/<name>/workflow.mjs (+ code/*.js).
// Usage: node scripts/build-workflows.mjs [--check]
//   --check  do not write; exit 1 if any workflow.json is missing or out of date.
import { readdirSync, existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'workflows');

export async function buildAll() {
  const out = [];
  for (const entry of readdirSync(DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const src = join(DIR, entry.name, 'workflow.mjs');
    if (!entry.isDirectory() || !existsSync(src)) continue;
    const mod = await import(pathToFileURL(src).href);
    if (!mod.default || typeof mod.default !== 'object' || !Array.isArray(mod.default.nodes)) {
      throw new Error(`${entry.name}/workflow.mjs must export a workflow object (with nodes) as default`);
    }
    out.push({ name: entry.name, path: join(DIR, entry.name, 'workflow.json'), json: `${JSON.stringify(mod.default, null, 2)}\n` });
  }
  return out;
}

async function main() {
  const check = process.argv.includes('--check');
  const built = await buildAll();
  let stale = 0;
  for (const b of built) {
    const current = existsSync(b.path) ? readFileSync(b.path, 'utf8') : null;
    if (current === b.json) {
      console.log(`up to date  ${b.name}`);
      continue;
    }
    if (check) {
      stale += 1;
      console.log(`STALE       ${b.name} (run: node scripts/build-workflows.mjs)`);
    } else {
      writeFileSync(b.path, b.json);
      console.log(`wrote       ${b.name}/workflow.json`);
    }
  }
  if (built.length === 0) {
    console.error('no workflows/*/workflow.mjs found');
    return 1;
  }
  return stale ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
