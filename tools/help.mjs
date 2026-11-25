// =============================================================================
// help.mjs — the user guides as searchable pages on the website (help/)
// -----------------------------------------------------------------------------
// Sources (Markdown, the same files people read on GitHub):
//   docs/USER_GUIDE.md        → help/linklab.html
//   docs/CAMLAB_GUIDE.md      → help/camlab.html
//   docs/help/how-do-i.md     → help/how-do-i.html   (short answers to questions)
// Each "## " and "### " heading becomes a topic with its own address
// (help/linklab.html#balancing), so a search result or a link can point at it.
//
// help/search-index.json lists every topic and every lesson; site/help.js
// searches it in the browser (no outside service, so it also works offline).
//
// How-do-I writing rules (checked by tools/tests/help.test.js):
//   "## LinkLab" or "## CamLab" starts that app's questions; "### " is one
//   question; an optional first line "keywords: a, b" adds words people may
//   search for that the answer does not use; **bold** is used only for words
//   shown on screen, so the test can check that the app still has them.
// tools/build.mjs calls buildHelp().
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { readLessons, APPS } from './tutorial.mjs';

// ---- CONFIG -------------------------------------------------------------------
export const HELP_PAGES = [
  { slug: 'linklab', app: 'linklab', source: 'docs/USER_GUIDE.md', title: 'LinkLab help',
    description: 'How to use LinkLab: graphical construction, building a linkage, kinematics, forces, balancing, tolerance and export.' },
  { slug: 'camlab', app: 'camlab', source: 'docs/CAMLAB_GUIDE.md', title: 'CamLab help',
    description: 'How to use CamLab: the motion program (SVAJ), sizing, forces, the part and its mounting, and export.' },
  { slug: 'how-do-i', source: 'docs/help/how-do-i.md', title: 'How do I…?', questions: true,
    description: 'Short answers to common questions about LinkLab and CamLab.' },
];
const TEMPLATE = 'site/learn.html';              // the page frame, shared with the lessons
const ASSETS = ['site/help.css', 'site/help.js']; // copied to help/
// -------------------------------------------------------------------------------

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "Export to CAD (SolidWorks, …)" → "export-to-cad-solidworks" style address. */
export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Markdown → plain text for the search index. */
export function plainText(md) {
  return md
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, ' ')            // table rule lines
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                    // pictures
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                  // links: keep the words
    .replace(/[*_`|]/g, ' ')
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Split a guide into topics. Returns { title, intro, topics }, each topic
 * { level (2 or 3), title, id, parent (title of its "## "), keywords, md }.
 */
export function parseGuide(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let title = '';
  const intro = [];
  const topics = [];
  let current = null, parent = null;
  for (const line of lines) {
    const m = line.match(/^(#{1,3}) (.+)$/);
    if (m && m[1].length === 1) { title = m[2].trim(); continue; }
    if (m) {
      const level = m[1].length;
      const name = m[2].trim();
      if (level === 2) parent = { title: name, id: slugify(name) };
      current = {
        level, title: name, md: [], keywords: '',
        id: level === 2 ? parent.id : `${parent ? `${parent.id}-` : ''}${slugify(name)}`,
        parent: level === 3 && parent ? parent.title : '',
      };
      topics.push(current);
      continue;
    }
    if (current && !current.md.length && /^keywords:/i.test(line)) { current.keywords = line.replace(/^keywords:/i, '').trim(); continue; }
    (current ? current.md : intro).push(line);
  }
  for (const t of topics) t.md = t.md.join('\n').trim();
  return { title: title.replace(/\s*\(v[\d.]+\)\s*$/, ''), intro: intro.join('\n').trim(), topics };
}

/** The words a How-do-I answer shows in bold: labels on screen. */
export function uiLabels(md) {
  return [...md.replace(/`[^`]*`/g, '').matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
}

/** Which app a question belongs to: the "## LinkLab" / "## CamLab" above it. */
export function appOfQuestion(topic) {
  return Object.keys(APPS).find((k) => APPS[k].name === topic.parent) || null;
}

/** Read and split every help page. */
export function readHelp(root) {
  return HELP_PAGES.filter((p) => fs.existsSync(path.join(root, p.source)))
    .map((p) => ({ ...parseGuide(fs.readFileSync(path.join(root, p.source), 'utf8')), ...p }));   // the page's own title wins
}

/** The search index: one entry per help topic and one per lesson. */
export function searchIndex(pages, lessons) {
  const entries = [];
  for (const p of pages) {
    for (const t of p.topics) {
      if (p.questions && t.level === 2) continue;   // "## LinkLab" on the questions page is only a group title
      entries.push({
        u: `${p.slug}.html#${t.id}`,
        t: t.title,
        p: p.questions ? `${t.parent} question` : (t.parent ? `${p.title} › ${t.parent}` : p.title),
        k: t.keywords,
        x: plainText(t.md),
      });
    }
  }
  for (const l of lessons) {
    const app = APPS[l.meta.app];
    entries.push({ u: `../learn/${l.slug}.html`, t: l.meta.title, p: `${app ? app.name : ''} lesson ${l.meta.order}`, k: '', x: plainText(`${l.meta.summary || ''} ${l.body}`) });
  }
  return entries;
}

/**
 * Write the help pages. `write(rel, data)` writes a file of the website,
 * `fill(text)` fills in the site's {{...}} values, `version(dir)` gives an
 * app's version. Returns the number of topics.
 */
export function buildHelp({ root, write, fill, version }) {
  const pages = readHelp(root);
  if (!pages.length) return 0;
  const lessons = readLessons(root);
  const template = fs.readFileSync(path.join(root, TEMPLATE), 'utf8');
  const marked = new Marked({ gfm: true });
  const site = fill('{{SITE_URL}}');
  const searchBox = `
      <form class="help-search" role="search" onsubmit="return false">
        <label for="help-q">Search the help and the lessons</label>
        <input id="help-q" type="search" placeholder="for example: fixed length, input torque, keyway" autocomplete="off" spellcheck="false">
        <div id="help-results" aria-live="polite"></div>
      </form>`;
  const page = ({ slug, title, description, content, extraHead = '' }) => {
    const head = [
      '<link rel="stylesheet" href="help.css">',
      '<script type="module" src="help.js"></script>',
      site ? `<link rel="canonical" href="${site}help/${slug === 'index' ? '' : slug}">` : '',
      extraHead,
    ].filter(Boolean).join('\n');
    return fill(template
      .replaceAll('{{PAGE_TITLE}}', escape(title))
      .replaceAll('{{PAGE_DESCRIPTION}}', escape(description))
      .replace('{{PAGE_CONTENT}}', () => content)
      .replace('</head>', () => `${head}\n</head>`));
  };
  const heading = (t) => `<h${t.level} id="${t.id}">${escape(t.title)} <a class="anchor" href="#${t.id}" aria-label="Link to this topic">#</a></h${t.level}>`;

  for (const p of pages) {
    const app = p.app ? APPS[p.app] : null;
    // contents: the "## " topics; on the questions page, every question under its app
    const top = p.topics.filter((t) => t.level === 2);
    const contents = p.questions
      ? top.map((g) => `<li>${escape(g.title)}<ul>${p.topics.filter((t) => t.level === 3 && t.parent === g.title)
        .map((t) => `<li><a href="#${t.id}">${escape(t.title)}</a></li>`).join('')}</ul></li>`).join('')
      : top.map((t) => `<li><a href="#${t.id}">${escape(t.title)}</a></li>`).join('');
    const body = p.topics.map((t) => `${heading(t)}\n${marked.parse(t.md)}`).join('\n');
    const meta = app
      ? `<p class="meta"><img src="../icons/${app.icon}.svg" alt="">Written for ${app.name} ${version(app.dir)} · <a href="${app.open}" target="_blank" rel="noopener">Open ${app.name}</a></p>`
      : '';
    // questions and answers in a form search engines read
    const extraHead = p.questions ? `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: p.topics.filter((t) => t.level === 3).map((t) => ({
        '@type': 'Question', name: t.title, acceptedAnswer: { '@type': 'Answer', text: plainText(t.md) } })),
    }).replace(/</g, '\\u003c')}</script>` : '';
    write(`help/${p.slug}.html`, page({
      slug: p.slug, title: `${p.title} — LinkLab and CamLab`, description: p.description, extraHead,
      content: `
      <p class="crumbs"><a href="./">Help</a> › ${escape(p.title)}</p>
      <h1>${escape(p.title)}</h1>
      ${meta}${searchBox}
      <nav class="help-contents" aria-label="On this page"><h2>On this page</h2><ul>${contents}</ul></nav>
      <article class="lesson">${p.intro ? marked.parse(p.intro) : ''}${body}</article>`,
    }));
  }

  // the front page of the help: search, then where to go
  const card = (p) => `<section class="help-card"><h2><a href="${p.slug}.html">${escape(p.title)}</a></h2><p>${escape(p.description)}</p><ul>${
    p.topics.filter((t) => t.level === (p.questions ? 3 : 2)).map((t) => `<li><a href="${p.slug}.html#${t.id}">${escape(t.title)}</a></li>`).join('')}</ul></section>`;
  const questions = pages.filter((p) => p.questions), guides = pages.filter((p) => !p.questions);
  write('help/index.html', page({
    slug: 'index', title: 'Help — LinkLab and CamLab',
    description: 'Help for LinkLab and CamLab: search every topic and lesson, short answers to common questions, and the full guide to each app.',
    content: `
      <h1>Help</h1>
      <p class="lead">Search every help topic and lesson, or pick a topic below. New here? Start with the <a href="../learn/">lessons</a>.</p>
      ${searchBox}
      ${[...questions, ...guides].map(card).join('')}`,
  }));

  const index = searchIndex(pages, lessons);
  write('help/search-index.json', JSON.stringify(index));
  for (const f of ASSETS) write(`help/${path.basename(f)}`, fs.readFileSync(path.join(root, f)));
  return index.length - lessons.length;
}
