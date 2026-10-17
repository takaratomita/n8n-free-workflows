# Hacker News keyword digest (n8n)

Get one email a day with the Hacker News stories that mention your keywords — and never the same story twice.

- Free Hacker News search API (Algolia), no API key
- One search per keyword, results merged and sorted by points
- Skips stories below a minimum score and stories already emailed
- The "already sent" list is saved **after** the email goes out, so a failed send is retried next run
- A keyword whose search fails is listed in the email instead of breaking the run

## Import

1. In n8n: **Workflows → Import from File** → `workflow.json`.
2. Edit the **Config** node: `keywords`, `lookbackHours`, `minPoints`, `maxPerKeyword`, `alertTo`, `fromEmail`.
3. Open **Send Digest** and select your SMTP credential.
4. Click **Test workflow** to try it, then **Activate**.

n8n keeps workflow static data only for active (production) executions, so manual test runs will show the same stories again. That is expected.

## Nodes

`Schedule Trigger` / `Manual Trigger` → `Config` → `Build Queries` → `Search HN` → `Pick New Stories` → `Any New Stories?` → `Send Digest` → `Save Seen`

Tested on n8n 2.41.6: imported and executed against the live Hacker News API with the email node swapped for a No-Op (every node ran, including Save Seen). The SMTP send itself needs your credential. The Code node logic has unit tests in [`scripts/test`](../../scripts/test).
