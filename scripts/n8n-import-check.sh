#!/usr/bin/env bash
# Import every workflows/*/workflow.json into a throwaway n8n container and export it back.
# Proves the files are importable by a real n8n (not just valid JSON).
#
# Usage: scripts/n8n-import-check.sh [n8n-version=2.41.6]
# Needs: docker (the image is pulled if missing). The container runs with --network none
# and is removed afterwards; nothing touches an existing n8n instance.
# Exit code: 0 when all workflows import and round-trip with the same node count.
set -euo pipefail
VERSION="${1:-2.41.6}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm --network none -e N8N_DIAGNOSTICS_ENABLED=false \
  -v "$ROOT/workflows:/wf:ro" --entrypoint sh "n8nio/n8n:${VERSION}" -c '
set -e
mkdir -p /tmp/in
for d in /wf/*/; do
  [ -f "$d/workflow.json" ] && cp "$d/workflow.json" "/tmp/in/$(basename "$d").json"
done
n8n import:workflow --separate --input=/tmp/in >/tmp/import.log 2>&1 || { tail -20 /tmp/import.log; exit 1; }
grep -E "Successfully imported|Importing" /tmp/import.log
n8n export:workflow --all --output=/tmp/all.json >/dev/null 2>&1
node -e "
const fs = require(\"fs\");
const exported = JSON.parse(fs.readFileSync(\"/tmp/all.json\", \"utf8\"));
let bad = 0;
for (const f of fs.readdirSync(\"/tmp/in\")) {
  const src = JSON.parse(fs.readFileSync(\"/tmp/in/\" + f, \"utf8\"));
  const got = exported.find((w) => w.name === src.name);
  const ok = got && got.nodes.length === src.nodes.length && Object.keys(got.connections).length === Object.keys(src.connections).length;
  console.log((ok ? \"OK   \" : \"FAIL \") + f + \"  nodes=\" + (got ? got.nodes.length : \"-\") + \"/\" + src.nodes.length);
  if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
"
'
