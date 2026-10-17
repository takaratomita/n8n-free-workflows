# Contact form webhook with spam scoring (n8n)

A drop-in backend for a website contact form: validate, score for spam, email the real messages to your team, answer the form with JSON.

## Request

`POST https://<your-n8n>/webhook/contact-form` with JSON or form-encoded fields:

| Field | Required | Notes |
|---|---|---|
| `name` | yes | up to 100 chars |
| `email` | yes | a plain address (no display name); becomes the Reply-To of the team email |
| `message` | yes | 10–5000 chars |
| `company` | no | |
| `hp_url` | no | **honeypot**: hide this input with CSS and `autocomplete="off"`; bots fill it, humans don't. It is deliberately not called `website`, because browsers autofill that |

## Responses

| Case | HTTP | Body |
|---|---|---|
| invalid input | 400 | `{ "ok": false, "errors": [...] }` |
| spam | 200 | `{ "ok": true, "ticketId": "…" }` (no email is sent; don't tell spammers) |
| ok | 200 | `{ "ok": true, "ticketId": "…" }` after the team email is sent |

## Spam score (tune in Config)

| Signal | Points |
|---|---|
| honeypot `hp_url` filled | +10 |
| email domain in `blockedDomains` | +5 |
| more than `maxLinks` links | +5 |
| each word from `blockedWords` | +2 |
| mostly upper case | +1 |

A message is spam when the score is ≥ `spamThreshold` (default 5).

## Import

1. **Workflows → Import from File** → `workflow.json`.
2. Edit **Config**: `siteName`, `teamEmail`, `fromEmail`, scoring settings.
3. Select your SMTP credential in **Notify Team** and **Send Auto-reply**.
4. Activate, then point your form at the production webhook URL.

`sendAutoReply` is **false** by default on purpose: a public form that emails whatever address is typed into it can be abused to send mail to strangers from your domain. Turn it on only behind rate limiting or a CAPTCHA. If the auto-reply fails, the form still gets its 200 (the team was already notified).

Tested on n8n 2.41.6: imported, activated and called over HTTP with the email nodes swapped for No-Op nodes — valid JSON → 200 + team notification, invalid → 400 with errors, spam → 200 without notification, form-encoded body → 200. The validation and scoring logic has unit tests in [`scripts/test`](../../scripts/test).
