import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeFrom, sticky, configNode, codeNode, ifNode, emailNode, connect } from '../../scripts/lib/n8n.mjs';

const code = codeFrom(dirname(fileURLToPath(import.meta.url)));

export default {
  name: 'Website uptime monitor with DOWN/UP email alerts (no flapping)',
  nodes: [
    sticky(
      'up-note-about',
      'About this workflow',
      [
        '## Website uptime monitor',
        'Checks a list of URLs every 5 minutes and emails you **only when a site changes state**: DOWN after N failures in a row, UP again with the downtime.',
        '',
        '### How it works',
        '1. **Split URLs** turns the Config list into one item per URL.',
        '2. **Check URL** requests each one (errors do not stop the run).',
        '3. **Evaluate** compares with the last state: 2xx/3xx = up; other status codes and network errors count as failures. Downtime is counted from the first failed check.',
        '4. **Changed?** → **Send Alert** → **Save State**. With no change, the state (failure counters) is saved directly.',
        '',
        '### Setup',
        '- Edit only the **Config** node.',
        '- Select your SMTP credential in **Send Alert**.',
        '- Activate the workflow. State is kept in workflow static data, which n8n saves only for active (production) runs.',
      ].join('\n'),
      [-420, -420],
      { width: 520, height: 520 },
    ),
    sticky(
      'up-note-config',
      'Config note',
      [
        '## Config',
        '- `urls`: comma or newline separated http(s) URLs (max 20)',
        '- `failuresBeforeAlert`: consecutive failures before DOWN (1–20)',
        '- `timeoutMs`: request timeout per URL (1000–10000). URLs are checked one by one, so 20 × timeout must stay well under the 5-minute schedule',
        '- `alertTo` / `fromEmail`: email addresses',
      ].join('\n'),
      [140, -300],
      { width: 380, height: 220, color: 4 },
    ),
    {
      parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } },
      id: 'up-schedule',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [0, 0],
    },
    {
      parameters: {},
      id: 'up-manual',
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 180],
    },
    configNode('up-config', [240, 80], {
      urls: 'https://example.com\nhttps://example.org',
      failuresBeforeAlert: 2,
      timeoutMs: 8000,
      alertTo: 'you@example.com',
      fromEmail: 'n8n@example.com',
    }),
    codeNode('up-split', 'Split URLs', code('split-urls.js'), [460, 80]),
    {
      parameters: {
        url: '={{ $json.url }}',
        options: {
          timeout: "={{ $('Config').first().json.timeoutMs }}",
          response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } },
        },
      },
      id: 'up-check',
      name: 'Check URL',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [680, 80],
      onError: 'continueRegularOutput',
    },
    codeNode('up-eval', 'Evaluate', code('evaluate.js'), [900, 80]),
    ifNode('up-if', 'Changed?', '={{ $json.hasChanges }}', [1120, 80]),
    emailNode(
      'up-email',
      'Send Alert',
      { to: '={{ $json.to }}', subject: '={{ $json.subject }}', text: '={{ $json.text }}' },
      [1340, 0],
    ),
    codeNode('up-save', 'Save State', code('save-state.js'), [1560, 80]),
  ],
  connections: connect([
    ['Schedule Trigger', 'Config'],
    ['Manual Trigger', 'Config'],
    ['Config', 'Split URLs'],
    ['Split URLs', 'Check URL'],
    ['Check URL', 'Evaluate'],
    ['Evaluate', 'Changed?'],
    ['Changed?', 'Send Alert', 0],
    ['Changed?', 'Save State', 1],
    ['Send Alert', 'Save State'],
  ]),
  settings: { executionOrder: 'v1' },
};
