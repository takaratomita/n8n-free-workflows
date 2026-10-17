import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeFrom, sticky, configNode, codeNode, ifNode, emailNode, connect } from '../../scripts/lib/n8n.mjs';

const code = codeFrom(dirname(fileURLToPath(import.meta.url)));
const respond = (id, name, body, status, position) => ({
  parameters: { respondWith: 'json', responseBody: body, options: { responseCode: status } },
  id,
  name,
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.5,
  position,
});

export default {
  name: 'Contact form webhook with spam scoring and team email',
  nodes: [
    sticky(
      'cf-note-about',
      'About this workflow',
      [
        '## Contact form triage',
        'A webhook endpoint for your website contact form. It validates the fields, scores the message for spam, emails real messages to your team and answers the form with JSON.',
        '',
        '### Request',
        '`POST /webhook/contact-form` with JSON or form fields: `name`, `email`, `message`, optional `company`, and a hidden honeypot field `hp_url` that humans leave empty.',
        '',
        '### Routing',
        '- invalid → **400** with the list of errors',
        '- spam (score ≥ `spamThreshold`) → **200** without any email (do not tell spammers)',
        '- ok → **Notify Team** (Reply-To = sender) → optional auto-reply → **200** with a ticket ID',
        '',
        '### Setup',
        '- Edit only the **Config** node; select your SMTP credential in both email nodes.',
        '- Auto-reply is **off** by default: anyone can make your server email any address through a public form. Turn it on only with rate limiting or a CAPTCHA in front.',
      ].join('\n'),
      [-460, -480],
      { width: 560, height: 600 },
    ),
    sticky(
      'cf-note-scoring',
      'Scoring note',
      [
        '## Spam score',
        '- honeypot `hp_url` filled: +10',
        '- email domain in `blockedDomains`: +5',
        '- more than `maxLinks` links: +5',
        '- each word from `blockedWords`: +2',
        '- mostly UPPER CASE: +1',
      ].join('\n'),
      [380, -320],
      { width: 360, height: 240, color: 4 },
    ),
    {
      parameters: { httpMethod: 'POST', path: 'contact-form', responseMode: 'responseNode', options: {} },
      id: 'cf-webhook',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2.1,
      position: [0, 80],
      webhookId: '0c8f2b9e-4d61-4f0a-9b57-3e2a6c1d8f43',
    },
    configNode('cf-config', [220, 80], {
      siteName: 'Your Site',
      teamEmail: 'team@example.com',
      fromEmail: 'forms@example.com',
      spamThreshold: 5,
      maxLinks: 2,
      blockedDomains: 'mailinator.com, yopmail.com, guerrillamail.com, 10minutemail.com, tempmail.com',
      blockedWords: 'casino, backlinks, seo services, crypto investment, loan offer',
      sendAutoReply: false,
    }),
    codeNode('cf-validate', 'Validate & Score', code('validate-and-score.js'), [440, 80]),
    ifNode('cf-if-valid', 'Valid?', "={{ $json.status !== 'invalid' }}", [660, 80]),
    ifNode('cf-if-spam', 'Spam?', "={{ $json.status === 'spam' }}", [880, 0]),
    emailNode(
      'cf-email-team',
      'Notify Team',
      { to: '={{ $json.to }}', subject: '={{ $json.subject }}', text: '={{ $json.text }}', replyTo: '={{ $json.replyTo }}' },
      [1100, 80],
    ),
    ifNode('cf-if-auto', 'Auto-reply On?', "={{ $('Config').first().json.sendAutoReply === true }}", [1320, 80]),
    emailNode(
      'cf-email-auto',
      'Send Auto-reply',
      {
        to: "={{ $('Validate & Score').first().json.email }}",
        subject: "={{ $('Validate & Score').first().json.autoReplySubject }}",
        text: "={{ $('Validate & Score').first().json.autoReplyText }}",
        // The team was already notified: a failed auto-reply must not turn into a 500 for the form.
        onError: 'continueRegularOutput',
      },
      [1540, 0],
    ),
    respond('cf-respond-ok', 'Respond OK', "={{ JSON.stringify({ ok: true, ticketId: $('Validate & Score').first().json.ticketId }) }}", 200, [1760, 80]),
    respond('cf-respond-bad', 'Respond 400', '={{ JSON.stringify({ ok: false, errors: $json.errors }) }}', 400, [880, 240]),
  ],
  connections: connect([
    ['Webhook', 'Config'],
    ['Config', 'Validate & Score'],
    ['Validate & Score', 'Valid?'],
    ['Valid?', 'Spam?', 0],
    ['Valid?', 'Respond 400', 1],
    ['Spam?', 'Respond OK', 0],
    ['Spam?', 'Notify Team', 1],
    ['Notify Team', 'Auto-reply On?'],
    ['Auto-reply On?', 'Send Auto-reply', 0],
    ['Auto-reply On?', 'Respond OK', 1],
    ['Send Auto-reply', 'Respond OK'],
  ]),
  settings: { executionOrder: 'v1' },
};
