// Minimal stand-in for the n8n Code node runtime ("Run Once for All Items" mode),
// enough to unit-test the jsCode we ship: $input.all()/first(), $('Node').all()/first(),
// $getWorkflowStaticData('global'). Items are passed as plain json objects.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadCode(workflowDir, file) {
  return readFileSync(join(ROOT, 'workflows', workflowDir, 'code', file), 'utf8');
}

const wrap = (list) => {
  const items = list.map((json) => ({ json }));
  return { all: () => items, first: () => items[0], last: () => items[items.length - 1] };
};

export async function runCode(source, { input = [], nodes = {}, staticData = {} } = {}) {
  const $input = wrap(input);
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`test harness: node "${name}" not provided`);
    return wrap(nodes[name]);
  };
  const $getWorkflowStaticData = (scope) => {
    if (scope !== 'global') throw new Error('only global static data is used');
    return staticData;
  };
  const fn = new AsyncFunction('$input', '$', '$getWorkflowStaticData', source);
  const out = await fn($input, $, $getWorkflowStaticData);
  if (!Array.isArray(out)) throw new Error('Code node must return an array');
  return out.map((i) => i.json);
}
