// One item per URL from Config "urls" (comma or newline separated).
const cfg = $('Config').first().json;

const urls = [];
for (const raw of String(cfg.urls ?? '').split(/[,\n]/)) {
  const u = raw.trim();
  if (!u || urls.includes(u)) continue;
  if (!/^https?:\/\/[^\s/?#]+/i.test(u)) {
    throw new Error(`Config "urls": "${u.slice(0, 100)}" is not an http(s) URL.`);
  }
  urls.push(u);
}
if (urls.length === 0) throw new Error('Config "urls" is empty. Add at least one http(s) URL.');
// URLs are checked one after another. 20 URLs x the timeout must stay well under the
// 5-minute schedule, or runs overlap and race on the saved state.
if (urls.length > 20) throw new Error(`Config "urls" has ${urls.length} entries; this workflow is meant for up to 20.`);
const timeoutMs = Number(cfg.timeoutMs);
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 10000) {
  throw new Error(`Config "timeoutMs" must be between 1000 and 10000 (got "${cfg.timeoutMs}").`);
}

return urls.map((url) => ({ json: { url } }));
