// =============================================================================
// help.js — the search box on the help pages
// -----------------------------------------------------------------------------
// Searches help/search-index.json (written by tools/help.mjs) in the browser.
// Each entry: { u: address, t: title, p: where it is, k: extra keywords,
// x: text }. Every word typed must be found in an entry; a word in the title
// counts most, then the keywords, then the text.
// tools/tests/help.test.js runs search() on the real index.
// =============================================================================

// ---- CONFIG -------------------------------------------------------------------
const INDEX_URL = 'search-index.json';
const MAX_RESULTS = 12;
const SNIPPET_CHARS = 150;
const SCORE = { title: 10, keyword: 6, text: 2, textRepeat: 1, textRepeatMax: 3, inside: 1 };
// words too common to help
const SKIP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'is', 'it', 'do', 'does', 'i', 'how', 'can', 'my', 'and', 'or', 'for', 'with', 'what', 'why']);
// -------------------------------------------------------------------------------

/** "Locking the lengths" → ["lock", "length"]: lower case, common endings dropped. */
export function words(query) {
  return query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !SKIP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w));
}

/** How many words of `text` start with `w`. */
function startsCount(text, w) {
  let n = 0, i = -1;
  while ((i = text.indexOf(w, i + 1)) !== -1) if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1])) n += 1;
  return n;
}

/** The best entries for a query, best first: [{ entry, score }]. */
export function search(index, query, max = MAX_RESULTS) {
  const terms = words(query);
  if (!terms.length) return [];
  const found = [];
  for (const entry of index) {
    const title = entry.t.toLowerCase(), keys = (entry.k || '').toLowerCase(), text = entry.x.toLowerCase();
    let score = 0, all = true;
    for (const w of terms) {
      const inText = startsCount(text, w);
      let s = 0;
      if (startsCount(title, w)) s += SCORE.title;
      if (startsCount(keys, w)) s += SCORE.keyword;
      if (inText) s += SCORE.text + SCORE.textRepeat * Math.min(inText - 1, SCORE.textRepeatMax);
      if (!s && (title.includes(w) || keys.includes(w) || text.includes(w))) s = SCORE.inside;
      if (!s) { all = false; break; }
      score += s;
    }
    if (all) found.push({ entry, score });
  }
  return found.sort((a, b) => b.score - a.score).slice(0, max);
}

/** A piece of the text round the first word found: { before, hit, after }. */
export function snippet(text, query) {
  const lower = text.toLowerCase();
  let at = -1, len = 0;
  for (const w of words(query)) {
    let i = -1;   // the first place a word starts with it; failing that, anywhere
    do { i = lower.indexOf(w, i + 1); } while (i > 0 && /[\p{L}\p{N}]/u.test(lower[i - 1]));
    if (i === -1) i = lower.indexOf(w);
    if (i !== -1 && (at === -1 || i < at)) { at = i; len = w.length; }
  }
  if (at === -1) return { before: text.slice(0, SNIPPET_CHARS), hit: '', after: '' };
  const start = Math.max(0, at - SNIPPET_CHARS / 3);
  return {
    before: (start ? '…' : '') + text.slice(start, at),
    hit: text.slice(at, at + len),
    after: text.slice(at + len, start + SNIPPET_CHARS) + (start + SNIPPET_CHARS < text.length ? '…' : ''),
  };
}

// ---- the page -------------------------------------------------------------------
if (typeof document !== 'undefined') {
  const input = document.getElementById('help-q');
  const out = document.getElementById('help-results');
  let index = null, loading = null;
  const load = () => (loading ||= fetch(INDEX_URL).then((r) => r.json()).then((j) => { index = j; }).catch(() => { loading = null; }));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

  async function show() {
    const q = input.value.trim();
    out.replaceChildren();
    if (!q) return;
    await load();
    if (input.value.trim() !== q) return;   // typed on while the index loaded
    if (!index) { out.append(el('p', 'none', 'The search list could not be loaded. Check the connection and try again.')); return; }
    const results = search(index, q);
    if (!results.length) { out.append(el('p', 'none', 'Nothing found. Try fewer or other words.')); return; }
    const list = el('ol');
    for (const { entry } of results) {
      const a = el('a');
      a.href = entry.u;
      a.append(el('b', '', entry.t), el('span', 'where', entry.p));
      const s = snippet(entry.x, q), p = el('span', 'text');
      p.append(s.before, el('mark', '', s.hit), s.after);
      a.append(p);
      const li = el('li');
      li.append(a);
      list.append(li);
    }
    out.append(list);
  }

  if (input && out) {
    input.addEventListener('focus', load, { once: true });
    input.addEventListener('input', show);
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; show(); } });
    // a result on this same page: go there and clear the list
    out.addEventListener('click', (e) => { if (e.target.closest('a')) setTimeout(() => { input.value = ''; out.replaceChildren(); }, 0); });
    // help/?q=words opens with the search already done
    const q = new URLSearchParams(location.search).get('q');
    if (q) { input.value = q; show(); }
  }
}
