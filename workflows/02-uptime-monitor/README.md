# Website uptime monitor with DOWN/UP alerts (n8n)

Check a list of URLs every 5 minutes and get an email only when something changes.

- **DOWN** only after `failuresBeforeAlert` failed checks in a row (no alert storms from one slow request)
- **UP** on the first good check again, with how long it was down (counted from the first failed check)
- 2xx/3xx = up; any other status code or a network error / timeout = failure
- One email per run, listing every URL that changed plus the ones still down
- State is saved after the alert is sent, so a failed email is retried next run

## Import

1. In n8n: **Workflows → Import from File** → `workflow.json`.
2. Edit the **Config** node: `urls` (comma or newline separated, up to 20), `failuresBeforeAlert`, `timeoutMs` (1000–10000), `alertTo`, `fromEmail`.
3. Open **Send Alert** and select your SMTP credential.
4. **Activate**. (Static data is only persisted for active executions.)

URLs are checked one after another, so the worst case for one run is about `20 × timeoutMs`. Keep that well under the 5-minute schedule: if runs overlap, they read and write the same saved state and an alert can be duplicated or lost. Usernames and passwords inside URLs (`https://user:pass@…`) are masked in the emails.

## Nodes

`Schedule Trigger` / `Manual Trigger` → `Config` → `Split URLs` → `Check URL` → `Evaluate` → `Changed?` → `Send Alert` → `Save State` (the "no change" branch goes straight to `Save State`)

Tested on n8n 2.41.6: imported and executed end to end against two live URLs. The Code node logic has unit tests in [`scripts/test`](../../scripts/test).
