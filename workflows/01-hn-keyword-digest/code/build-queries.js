// Turn the comma/newline separated keyword list from Config into one item per search.
const cfg = $('Config').first().json;

const seen = new Set();
const keywords = String(cfg.keywords ?? '')
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter((s) => {
    const key = s.toLowerCase();
    if (!s || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

if (keywords.length === 0) {
  throw new Error('Config "keywords" is empty. Add at least one keyword (comma or newline separated).');
}
if (keywords.length > 20) {
  throw new Error(`Config "keywords" has ${keywords.length} entries. Keep it to 20 or fewer to stay polite to the HN API.`);
}

const lookbackHours = Number(cfg.lookbackHours);
if (!Number.isFinite(lookbackHours) || lookbackHours <= 0 || lookbackHours > 168) {
  throw new Error(`Config "lookbackHours" must be a number between 1 and 168 (got "${cfg.lookbackHours}").`);
}

const perKeyword = Math.min(Math.max(Math.floor(Number(cfg.maxPerKeyword)) || 20, 1), 100);
const since = Math.floor(Date.now() / 1000) - Math.round(lookbackHours * 3600);

return keywords.map((keyword) => ({ json: { keyword, since, hitsPerPage: perKeyword } }));
