// Merge the search results, drop stories that were already sent or are below
// minPoints, and build the digest email. The "already sent" list lives in the
// workflow's static data; it is only written by "Save Seen" AFTER the email was
// sent, so a failed send means the stories are retried next run.
// Note: n8n only persists static data for production (active) executions,
// not for manual test runs.
const cfg = $('Config').first().json;
const queries = $('Build Queries').all().map((i) => i.json);
const responses = $input.all();

const MAX_SEEN = 2000;
const minPoints = Math.max(Number(cfg.minPoints) || 0, 0);

// External text goes into an email: strip control characters and invisible/bidi formatting
// characters (ZWJ/ZWNJ are kept: emoji sequences and some scripts need them), cap the length.
const cp = (...c) => String.fromCodePoint(...c);
const INVISIBLE = new RegExp(`[${cp(0x200b, 0x200e, 0x200f, 0x2060, 0xfeff)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`, 'gu');
const oneLine = (v, max) => {
  const s = String(v ?? '').replace(INVISIBLE, '').replace(/[\p{Cc}\s]+/gu, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? oneLine(u, 500) : null);

const store = $getWorkflowStaticData('global');
const seenList = Array.isArray(store.hnSeen) ? store.hnSeen.map(String) : [];
const seen = new Set(seenList);

const fresh = new Map();
const failed = [];
responses.forEach((item, i) => {
  const keyword = queries[i]?.keyword ?? `#${i + 1}`;
  const hits = item.json?.hits;
  if (!Array.isArray(hits)) {
    failed.push(keyword);
    return;
  }
  for (const h of hits) {
    const id = String(h?.objectID ?? '').trim();
    if (!id || seen.has(id)) continue;
    const points = Number(h.points) || 0;
    if (points < minPoints) continue;
    if (fresh.has(id)) {
      const s = fresh.get(id);
      if (!s.keywords.includes(keyword)) s.keywords.push(keyword);
      continue;
    }
    const discussion = `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;
    fresh.set(id, {
      id,
      title: oneLine(h.title ?? h.story_title ?? '(untitled)', 200),
      url: safeUrl(h.url) ?? discussion,
      discussion,
      points,
      comments: Number(h.num_comments) || 0,
      author: oneLine(h.author, 50),
      keywords: [keyword],
    });
  }
});

if (failed.length && failed.length === responses.length) {
  throw new Error(`The Hacker News search failed for every keyword (${failed.join(', ')}). Check the "Search HN" node output.`);
}

const stories = [...fresh.values()].sort((a, b) => b.points - a.points);
const newSeen = [...seenList, ...stories.map((s) => s.id)].slice(-MAX_SEEN);

const lines = [
  `${stories.length} new Hacker News ${stories.length === 1 ? 'story' : 'stories'} matching your keywords` +
    ` (last ${cfg.lookbackHours}h, at least ${minPoints} points):`,
  '',
];
stories.forEach((s, n) => {
  lines.push(`${n + 1}. ${s.title}`);
  lines.push(`   ${s.points} points · ${s.comments} comments · by ${s.author} · matched: ${s.keywords.join(', ')}`);
  lines.push(`   ${s.url}`);
  if (s.url !== s.discussion) lines.push(`   Discussion: ${s.discussion}`);
  lines.push('');
});
if (failed.length) lines.push(`Note: these keywords could not be searched: ${failed.join(', ')}`);
lines.push('Sent by the "HN keyword digest" n8n workflow.');

const topKeywords = [...new Set(stories.flatMap((s) => s.keywords))].slice(0, 3).join(', ');

return [
  {
    json: {
      hasNew: stories.length > 0,
      count: stories.length,
      to: cfg.alertTo,
      subject: `[HN digest] ${stories.length} new ${stories.length === 1 ? 'story' : 'stories'}: ${oneLine(topKeywords, 80)}`,
      text: lines.join('\n'),
      stories,
      newSeen,
    },
  },
];
