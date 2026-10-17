// Runs inside the n8n container after the webhook requests of scripts/n8n-run-check.sh.
// Reads the executions of workflow 03 from n8n's SQLite database (oldest first) and checks
// which nodes ran, so that "spam -> 200 without notifying the team" is actually verified,
// not only the HTTP status. Usage: node n8n-run-check-webhook.cjs <workflowId> <expectations>
// expectations: one per request, separated by ";", each "+Node" (must run) or "-Node" (must not), comma separated.
const path = require('path');

const N8N_ROOT = '/usr/local/lib/node_modules/n8n';
let sqlite3;
try {
  sqlite3 = require(require.resolve('sqlite3', { paths: [N8N_ROOT, path.join(N8N_ROOT, 'node_modules/@n8n/db')] }));
} catch (e) {
  console.log(`  cannot load sqlite3 from the n8n image (${e.message})`);
  process.exit(1);
}

const [workflowId, expectArg] = process.argv.slice(2);
const expectations = expectArg.split(';').map((s) => s.split(',').filter(Boolean));
const db = new sqlite3.Database('/home/node/.n8n/database.sqlite', sqlite3.OPEN_READONLY);
db.all(
  'select e.id as id, d.data as data from execution_entity e join execution_data d on d.executionId = e.id where e.workflowId = ? order by e.id',
  [workflowId],
  (err, rows) => {
    if (err) {
      console.log(`  query failed: ${err.message}`);
      process.exit(1);
    }
    if (rows.length !== expectations.length) {
      console.log(`  expected ${expectations.length} executions, found ${rows.length}`);
      process.exit(1);
    }
    let failed = false;
    rows.forEach((row, i) => {
      // Execution data is stored "flatted"; node names of executed nodes appear as JSON strings.
      const ran = (name) => row.data.includes(JSON.stringify(name));
      const problems = [];
      for (const e of expectations[i]) {
        const name = e.slice(1);
        if (e[0] === '+' && !ran(name)) problems.push(`"${name}" did not run`);
        if (e[0] === '-' && ran(name)) problems.push(`"${name}" ran but must not`);
      }
      if (problems.length) failed = true;
      console.log(`  request ${i + 1} (execution ${row.id}): ${problems.length ? problems.join('; ') : 'nodes as expected'}`);
    });
    process.exit(failed ? 1 : 0);
  },
);
