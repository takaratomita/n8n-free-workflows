// Compare this run's results with the previous state and decide what to alert.
// - A URL is "up" for HTTP 2xx/3xx, "down" for anything else or a network error.
// - It only flips to DOWN after `failuresBeforeAlert` consecutive failures (no flapping alerts).
// - It flips back to UP on the first success; the downtime is counted from the FIRST failed check.
// State is saved by "Save State" after this run's alert (if any) was sent.
const cfg = $('Config').first().json;
const targets = $('Split URLs').all().map((i) => i.json.url);
const results = $input.all();

const threshold = Number(cfg.failuresBeforeAlert);
if (!Number.isInteger(threshold) || threshold < 1 || threshold > 20) {
  throw new Error(`Config "failuresBeforeAlert" must be an integer from 1 to 20 (got "${cfg.failuresBeforeAlert}").`);
}

const cp = (...c) => String.fromCodePoint(...c);
const INVISIBLE = new RegExp(`[${cp(0x200b, 0x200e, 0x200f, 0x2060, 0xfeff)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, 'gu');
// Never put user:password@ from a URL into an email (also inside error messages).
const hideCreds = (s) => String(s ?? '').replace(/(:\/\/)[^/\s@]{1,256}@/g, '$1***@');
const oneLine = (v, max) => {
  const s = hideCreds(v).replace(INVISIBLE, '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const minutes = (fromIso, toMs) => {
  const t = Date.parse(fromIso);
  return Number.isFinite(t) ? Math.max(Math.round((toMs - t) / 60000), 0) : null;
};

const now = Date.now();
const nowIso = new Date(now).toISOString();
const store = $getWorkflowStaticData('global');
const prev = store.uptime && typeof store.uptime === 'object' ? store.uptime : {};

const next = {};
const changes = [];
targets.forEach((url, i) => {
  const r = results[i]?.json ?? {};
  const code = Number(r.statusCode);
  const hasCode = Number.isInteger(code) && code > 0;
  const ok = hasCode && code >= 200 && code < 400;
  const err = r.error && typeof r.error === 'object' ? r.error.message ?? r.error.description : r.error;
  const detail = hasCode ? `HTTP ${code}` : `no response (${oneLine(err || 'unknown error', 200)})`;

  // State is keyed by the URL with any user:password@ masked, so credentials never land in static data.
  const key = hideCreds(url);
  const p = prev[key] && typeof prev[key] === 'object' ? prev[key] : { state: 'up', fails: 0, since: null };
  const fails = ok ? 0 : (Number(p.fails) || 0) + 1;
  const firstFailAt = ok ? null : fails === 1 || !p.firstFailAt ? nowIso : p.firstFailAt;
  let state;
  if (ok) state = 'up';
  else if (p.state === 'down' || fails >= threshold) state = 'down';
  else state = 'up';

  const since = state === 'down' ? (p.state === 'down' && p.since ? p.since : firstFailAt) : null;
  if (state !== p.state) {
    changes.push({ url: key, to: state, detail, downMinutes: state === 'up' ? minutes(p.since, now) : null });
  }
  next[key] = { state, fails, firstFailAt, since, lastDetail: detail, checkedAt: nowIso };
});

const downs = changes.filter((c) => c.to === 'down');
const ups = changes.filter((c) => c.to === 'up');
const parts = [];
if (downs.length) parts.push(`${downs.length} DOWN`);
if (ups.length) parts.push(`${ups.length} UP`);

const lines = [];
for (const c of downs) lines.push(`DOWN  ${oneLine(c.url, 300)}  ${c.detail} (failed ${threshold} check${threshold === 1 ? '' : 's'} in a row)`);
for (const c of ups) {
  const d = c.downMinutes === null ? '' : `, was down for ${c.downMinutes} min`;
  lines.push(`UP    ${oneLine(c.url, 300)}  ${c.detail}${d}`);
}
const stillDown = Object.entries(next).filter(([u, s]) => s.state === 'down' && !downs.some((c) => c.url === u));
if (stillDown.length) {
  lines.push('', 'Still down:');
  for (const [u, s] of stillDown) lines.push(`  ${oneLine(u, 300)} since ${s.since} (${s.lastDetail})`);
}
lines.push('', `Checked ${targets.length} URL${targets.length === 1 ? '' : 's'} at ${nowIso}.`, 'Sent by the "Uptime monitor" n8n workflow.');

return [
  {
    json: {
      hasChanges: changes.length > 0,
      to: cfg.alertTo,
      subject: `[Uptime] ${parts.join(', ') || 'no change'}: ${oneLine(changes.map((c) => c.url).join(', '), 120)}`,
      text: lines.join('\n'),
      changes,
      newState: next,
    },
  },
];
