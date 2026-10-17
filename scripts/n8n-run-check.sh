#!/usr/bin/env bash
# Execute the shipped workflows in a throwaway n8n container, with every Send Email node
# swapped for a No-Op (no SMTP credentials needed):
#   01  HN digest            -> `n8n execute` (calls the public hn.algolia.com API)
#   02  uptime monitor       -> `n8n execute` (requests example.com / example.org: "no change" path)
#   02b uptime, alert path   -> `n8n execute` with an unreachable URL and failuresBeforeAlert=1
#   03  contact form         -> activated, 4 HTTP requests to its production webhook, then the
#                               executed nodes of each request are read from n8n's database
#
# Usage: scripts/n8n-run-check.sh [n8n-version=2.41.6] [host-port=5699]
# Needs: docker, outbound HTTPS from the container. The container is removed afterwards.
# Exit code: 0 only when every check below passes.
set -euo pipefail
VERSION="${1:-2.41.6}"
PORT="${2:-5699}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="n8n-run-check-$$"
BODY="$(mktemp "${TMPDIR:-/tmp}/n8n-run-check-body.XXXXXX")"

cleanup() {
  docker stop "$NAME" >/dev/null 2>&1 || true
  rm -f "$BODY"
}
trap cleanup EXIT

docker run -d --rm --name "$NAME" -p "127.0.0.1:${PORT}:5678" \
  -e N8N_DIAGNOSTICS_ENABLED=false -e N8N_SECURE_COOKIE=false \
  -v "$ROOT/workflows:/wf:ro" -v "$ROOT/scripts/lib:/chk:ro" \
  --entrypoint sh "n8nio/n8n:${VERSION}" -c '
node /chk/n8n-run-check-prepare.cjs >/tmp/prepare.log 2>&1
n8n import:workflow --separate --input=/tmp/in >/tmp/import.log 2>&1
n8n update:workflow --id=03runcheck0000000 --active=true >/tmp/activate.log 2>&1 || n8n publish:workflow --id=03runcheck0000000 >>/tmp/activate.log 2>&1
exec n8n start' >/dev/null

show_logs() {
  echo "-- container logs (prepare / import / activate / server) --"
  docker exec "$NAME" sh -c 'cat /tmp/prepare.log /tmp/import.log /tmp/activate.log 2>/dev/null' | tail -40 || true
  docker logs "$NAME" 2>&1 | tail -20 || true
}

ready=0
for _ in $(seq 1 90); do
  if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/healthz" 2>/dev/null | grep -q 200; then ready=1; break; fi
  sleep 2
done
if [ "$ready" != 1 ]; then
  echo "n8n did not become healthy within 180s"
  show_logs
  exit 1
fi

status=0
execute() { # id, required nodes, implications
  echo "== execute $1"
  # The running server already owns the task-runner broker port, so the CLI run uses another one.
  docker exec -e N8N_RUNNERS_BROKER_PORT=5681 "$NAME" sh -c \
    "n8n execute --id $1 --rawOutput >/tmp/out-$1.txt 2>/tmp/err-$1.txt; node /chk/n8n-run-check-summary.cjs /tmp/out-$1.txt '$2' '$3' || { tail -5 /tmp/err-$1.txt; exit 1; }" || status=1
}
execute 01runcheck0000000 'Config,Build Queries,Search HN,Pick New Stories,Any New Stories?' 'Send Digest>Save Seen'
execute 02runcheck0000000 'Config,Split URLs,Check URL,Evaluate,Changed?,Save State' ''
execute 2brunchk0000000 'Config,Split URLs,Check URL,Evaluate,Changed?,Send Alert,Save State' ''

echo "== webhook 03"
U="http://127.0.0.1:${PORT}/webhook/contact-form"
check() {
  local want="$1"; shift
  local got
  got=$(curl -s -o "$BODY" -w '%{http_code}' "$@" "$U" || true)
  echo "  want $want got $got  $(head -c 200 "$BODY" 2>/dev/null)"
  [ "$got" = "$want" ] || status=1
}
sleep 3
check 200 -H 'Content-Type: application/json' -d '{"name":"Ada","email":"ada@example.org","message":"I would like a quote for 200 widgets please."}'
check 400 -H 'Content-Type: application/json' -d '{"name":"","email":"nope","message":"hi"}'
check 200 -H 'Content-Type: application/json' -d '{"name":"Bot","email":"x@mailinator.com","message":"Cheap seo services and backlinks here","hp_url":"http://x.example.com"}'
check 200 --data-urlencode 'name=Bob' --data-urlencode 'email=bob@example.org' --data-urlencode 'message=Hello from an HTML form post.'
sleep 2
echo "== executed nodes per webhook request"
docker exec "$NAME" node /chk/n8n-run-check-webhook.cjs 03runcheck0000000 \
  '+Notify Team,+Respond OK,-Respond 400,-Send Auto-reply;+Respond 400,-Notify Team,-Respond OK;+Respond OK,-Notify Team,-Respond 400;+Notify Team,+Respond OK,-Respond 400' || status=1

[ "$status" = 0 ] || show_logs
echo "== result: $([ "$status" = 0 ] && echo PASS || echo FAIL)"
exit "$status"
