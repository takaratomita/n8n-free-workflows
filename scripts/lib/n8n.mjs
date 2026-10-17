// Small helpers to describe n8n workflows in JS and build importable workflow.json files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function codeFrom(dir) {
  return (file) => readFileSync(join(dir, 'code', file), 'utf8');
}

export function sticky(id, name, content, position, { width = 400, height = 300, color } = {}) {
  return {
    parameters: { content, width, height, ...(color ? { color } : {}) },
    id,
    name,
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position,
  };
}

export function configNode(id, position, values) {
  return {
    parameters: {
      assignments: {
        assignments: Object.entries(values).map(([name, value], i) => ({
          id: `${id}-${String(i).padStart(2, '0')}`,
          name,
          value,
          type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
        })),
      },
      includeOtherFields: true,
      options: {},
    },
    id,
    name: 'Config',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position,
  };
}

export function codeNode(id, name, jsCode, position) {
  return { parameters: { jsCode }, id, name, type: 'n8n-nodes-base.code', typeVersion: 2, position };
}

export function ifNode(id, name, leftValue, position) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [
          {
            id: `${id}-c0`,
            leftValue,
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
    id,
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    position,
  };
}

export function emailNode(id, name, { to, subject, text, replyTo, onError }, position) {
  return {
    parameters: {
      fromEmail: "={{ $('Config').first().json.fromEmail }}",
      toEmail: to,
      subject,
      emailFormat: 'text',
      text,
      options: { appendAttribution: false, ...(replyTo ? { replyTo } : {}) },
    },
    id,
    name,
    type: 'n8n-nodes-base.emailSend',
    typeVersion: 2.1,
    position,
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    ...(onError ? { onError } : {}),
  };
}

/**
 * Build the connections object from edges: [from, to] or [from, to, outputIndex].
 */
export function connect(edges) {
  const out = {};
  for (const [from, to, outIndex = 0] of edges) {
    out[from] ??= { main: [] };
    const main = out[from].main;
    while (main.length <= outIndex) main.push([]);
    main[outIndex].push({ node: to, type: 'main', index: 0 });
  }
  return out;
}
