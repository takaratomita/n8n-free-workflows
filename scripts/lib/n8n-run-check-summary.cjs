// Runs inside the n8n container: summarise the raw output of `n8n execute --rawOutput`.
// Usage: node n8n-run-check-summary.cjs <output-file> <required nodes, comma separated> [<A>B,...>]
//   required: nodes that must have run; "A>B": if node A ran, node B must have run too.
// Exit 1 when a node errored, a required node did not run, or an implication is broken.
const fs = require('fs');

const [file, requiredArg = '', impliesArg = ''] = process.argv.slice(2);
const text = fs.readFileSync(file, 'utf8');
let run = null;
// The JSON document starts at the beginning of a line; log lines before it may contain "{".
for (const m of text.matchAll(/^\{/gm)) {
  try {
    run = JSON.parse(text.slice(m.index));
    break;
  } catch {
    // try the next candidate
  }
}
if (!run) {
  console.log('  no execution JSON in output');
  process.exit(1);
}

const runData = run.data?.resultData?.runData ?? {};
let failed = false;
for (const [name, runs] of Object.entries(runData)) {
  const r = runs[0];
  const counts = (r.data?.main ?? []).map((b) => (b ? b.length : 0));
  if (r.error) failed = true;
  console.log(`  ${name.padEnd(22)} items=${JSON.stringify(counts)}${r.error ? `  ERROR: ${r.error.message}` : ''}`);
}
const err = run.data?.resultData?.error;
if (err) {
  failed = true;
  console.log(`  workflow error: ${err.message}`);
}
for (const name of requiredArg.split(',').filter(Boolean)) {
  if (!(name in runData)) {
    failed = true;
    console.log(`  MISSING required node: ${name}`);
  }
}
for (const rule of impliesArg.split(',').filter(Boolean)) {
  const [a, b] = rule.split('>');
  if (a in runData && !(b in runData)) {
    failed = true;
    console.log(`  MISSING: "${a}" ran but "${b}" did not`);
  }
}
process.exit(failed ? 1 : 0);
