// Runs inside the n8n container (see scripts/n8n-run-check.sh).
// Copies the shipped workflows to /tmp/in with fixed IDs and replaces every Send Email node
// with a No-Op node, so the workflows can execute without SMTP credentials.
// Also writes a variant of 02 ("02b") whose Config contains an unreachable URL and
// failuresBeforeAlert = 1, so the alert branch (Changed? -> Send Alert -> Save State) runs.
const fs = require('fs');
const path = require('path');

fs.mkdirSync('/tmp/in', { recursive: true });

function prepare(wf, id, file) {
  wf.id = id;
  for (const n of wf.nodes) {
    if (n.type === 'n8n-nodes-base.emailSend') {
      n.type = 'n8n-nodes-base.noOp';
      n.typeVersion = 1;
      n.parameters = {};
    }
  }
  fs.writeFileSync(path.join('/tmp/in', file), JSON.stringify(wf));
  console.log(`prepared ${file} as ${id}`);
}

for (const dir of fs.readdirSync('/wf').sort()) {
  const file = path.join('/wf', dir, 'workflow.json');
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  prepare(JSON.parse(source), `${dir.slice(0, 2)}runcheck0000000`, `${dir}.json`);

  if (dir.startsWith('02-')) {
    const variant = JSON.parse(source);
    variant.name = `${variant.name} (alert path check)`;
    const config = variant.nodes.find((n) => n.name === 'Config');
    for (const a of config.parameters.assignments.assignments) {
      if (a.name === 'urls') a.value = 'https://example.com\nhttps://nonexistent-host.invalid/health';
      if (a.name === 'failuresBeforeAlert') a.value = 1;
      if (a.name === 'timeoutMs') a.value = 5000;
    }
    prepare(variant, '2brunchk0000000', '02b-uptime-monitor-alert.json');
  }
}
