// Validate the form submission, score it for spam and prepare the team email.
// Output status: "invalid" (400 to the form), "spam" (silently accepted, no email),
// or "ok" (team is emailed). Scoring rules are in Config so you can tune them.
const cfg = $('Config').first().json;
const req = $('Webhook').first().json;
const body = req.body && typeof req.body === 'object' ? req.body : {};

const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
// Strip invisible/bidi formatting characters but keep ZWJ/ZWNJ (needed by emoji and some scripts).
const cp = (...c) => String.fromCodePoint(...c);
const INVISIBLE = new RegExp(`[${cp(0x200b, 0x200e, 0x200f, 0x2060, 0xfeff)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, 'gu');
const oneLine = (v, max) => {
  const s = str(v).replace(INVISIBLE, '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const list = (v) => str(v).split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

// Honeypot: a hidden input named "hp_url". Not "website"/"url": browsers and password
// managers autofill those, which would silently drop real messages.
const HONEYPOT_FIELD = 'hp_url';
// Plain address only (no display names, quotes, angle brackets or lists): it becomes Reply-To.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;

const name = oneLine(body.name, 100);
const email = oneLine(body.email, 254).toLowerCase();
const company = oneLine(body.company, 100);
const rawMessage = str(body.message).replace(/\r\n?/g, '\n').replace(INVISIBLE, '');
const message = rawMessage.replace(/[^\P{Cc}\n\t]/gu, '').trim();
const honeypot = str(body[HONEYPOT_FIELD]).trim();

const errors = [];
if (!name) errors.push('name is required');
if (!EMAIL_RE.test(email)) errors.push('email is not a valid address');
if (message.length < 10) errors.push('message must be at least 10 characters');
if (message.length > 5000) errors.push('message must be at most 5000 characters');

const ticketId = Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

if (errors.length) {
  return [{ json: { status: 'invalid', errors, ticketId } }];
}

let score = 0;
const reasons = [];
if (honeypot) {
  score += 10;
  reasons.push(`honeypot field "${HONEYPOT_FIELD}" was filled (+10)`);
}
const domain = email.split('@')[1] ?? '';
if (list(cfg.blockedDomains).some((d) => domain === d || domain.endsWith(`.${d}`))) {
  score += 5;
  reasons.push(`disposable/blocked email domain ${domain} (+5)`);
}
const haystack = `${name} ${company} ${message}`.toLowerCase();
for (const w of list(cfg.blockedWords)) {
  if (haystack.includes(w)) {
    score += 2;
    reasons.push(`blocked word "${w}" (+2)`);
  }
}
const links = (message.match(/https?:\/\/|www\./gi) || []).length;
const maxLinks = Number.isFinite(Number(cfg.maxLinks)) ? Number(cfg.maxLinks) : 2;
if (links > maxLinks) {
  score += 5;
  reasons.push(`${links} links (more than ${maxLinks}) (+5)`);
}
const letters = message.replace(/[^A-Za-z]/g, '');
if (letters.length >= 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) {
  score += 1;
  reasons.push('mostly upper case (+1)');
}

const threshold = Number(cfg.spamThreshold) > 0 ? Number(cfg.spamThreshold) : 5;
const status = score >= threshold ? 'spam' : 'ok';
const site = oneLine(cfg.siteName, 60) || 'your site';

const text = [
  `New message from the ${site} contact form (ticket ${ticketId}).`,
  '',
  `Name:    ${name}`,
  `Email:   ${email}`,
  ...(company ? [`Company: ${company}`] : []),
  `Spam score: ${score} (threshold ${threshold})${reasons.length ? ` — ${reasons.join('; ')}` : ''}`,
  '',
  '--- message ---',
  message,
  '---------------',
  '',
  'Reply to this email to answer the sender directly.',
].join('\n');

return [
  {
    json: {
      status,
      score,
      reasons,
      ticketId,
      name,
      email,
      replyTo: email,
      to: cfg.teamEmail,
      subject: `[${site}] Contact form: ${name} (${ticketId})`,
      text,
      autoReplySubject: `We received your message (${ticketId})`,
      autoReplyText: [
        `Hi ${name},`,
        '',
        `Thanks for contacting ${site}. We received your message and will get back to you soon.`,
        `Your reference: ${ticketId}`,
        '',
        'This is an automatic reply.',
      ].join('\n'),
    },
  },
];
