# Free n8n workflows

Three importable n8n workflows. Each one has a single **Config** node to edit, sticky notes that explain it, and no credentials baked in.

| Workflow | What it does |
|---|---|
| [01 Hacker News keyword digest](workflows/01-hn-keyword-digest) | Daily email with new HN stories for your keywords, never the same story twice |
| [02 Uptime monitor](workflows/02-uptime-monitor) | Checks URLs every 5 min, emails DOWN after N failures in a row and UP with the downtime |
| [03 Contact form triage](workflows/03-contact-form-triage) | Webhook for a website form: validation, spam scoring, team email with Reply-To, JSON response |

## Import

1. Download the `workflow.json` of the workflow you want.
2. In n8n: **Workflows → Import from File**.
3. Edit the **Config** node, select your SMTP credential in the email node(s), activate.

Tested on n8n 2.41.6.

## How these are checked

- `node scripts/validate-workflows.mjs` — structure (unique node names/ids, connections, a trigger, no orphan nodes), Code-node syntax, and a secrets/template scan with the bundled `n8n-preflight` (no keys, no credential IDs, no pinned data, sticky notes present).
- `npm test` — unit tests for every Code node's logic (Node 18+, no dependencies).
- `scripts/n8n-import-check.sh` — imports all workflows into a throwaway n8n Docker container (no network) and exports them back.
- `scripts/n8n-run-check.sh` — runs them in a throwaway n8n container with the email nodes swapped for No-Op nodes: 01 and 02 via `n8n execute` (02 twice: the "no change" path and the alert path), 03 via four real HTTP requests to its webhook, checking which nodes ran for each request.

The JSON files are generated from `workflows/*/workflow.mjs` and `workflows/*/code/*.js` with `node scripts/build-workflows.mjs`; edit those and rebuild.

## License

MIT
