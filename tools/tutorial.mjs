// =============================================================================
// tutorial.mjs — the lessons in docs/tutorial/ as pages on the website (learn/)
// -----------------------------------------------------------------------------
// Each lesson is a Markdown file with a short header:
//   ---
//   title: Your first fourbar
//   app: linklab            (linklab or camlab)
//   order: 1                (its place in that app's list)
//   time: 15 minutes
//   summary: One sentence for the list of lessons.
//   ---
// Writing rules (checked by tools/tests/tutorial.test.js):
//   **bold** is used only for words shown on screen (a button, a menu, a
//   panel), so the test can check that the app still has each of them;
//   pictures are in docs/tutorial/img/ and are retaken by
//   npm run tutorial-shots, which also checks the numbers the lesson quotes.
// tools/build.mjs calls buildTutorial() to write learn/index.html, one page
// per lesson and the pictures.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';

// ---- CONFIG -------------------------------------------------------------------
export const TUTORIAL_DIR = 'docs/tutorial';
export const APPS = {
  linklab: { name: 'LinkLab', dir: 'apps/linklab', open: '../app/', icon: 'linklab' },
  camlab: { name: 'CamLab', dir: 'apps/camlab', open: '../camlab/', icon: 'camlab' },
};
const TEMPLATE = 'site/learn.html';
// -------------------------------------------------------------------------------

/** Split a lesson into its header fields and its Markdown text. */
export function parseLesson(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('a lesson must start with a --- header ---');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const k = line.indexOf(':');
    if (k > 0) meta[line.slice(0, k).trim()] = line.slice(k + 1).trim();
  }
  meta.order = Number(meta.order);
  return { meta, body: m[2] };
}

/** Every lesson, in the order they are listed: by app, then by `order`. */
export function readLessons(root) {
  const dir = path.join(root, TUTORIAL_DIR);
  if (!fs.existsSync(dir)) return [];
  const appOrder = Object.keys(APPS);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => ({ file: f, slug: f.replace(/\.md$/, ''), ...parseLesson(fs.readFileSync(path.join(dir, f), 'utf8')) }))
    .sort((a, b) => appOrder.indexOf(a.meta.app) - appOrder.indexOf(b.meta.app) || a.meta.order - b.meta.order);
}

/** The words a lesson shows in bold (outside code), i.e. the labels on screen it names. */
export function uiLabels(body) {
  const text = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  return [...text.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
}

/** The files a lesson links to under files/ (paths relative to docs/tutorial/). */
export function linkedFiles(body) {
  return [...body.matchAll(/\]\((files\/[^)\s]+)\)/g)].map((m) => m[1]);
}

/** The pictures a lesson uses (paths relative to docs/tutorial/). */
export function images(body) {
  return [...body.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Write the lesson pages. `write(rel, data)` writes a file of the website,
 * `fill(text)` fills in the site's {{...}} values, `version(dir)` gives an
 * app's version.
 */
export function buildTutorial({ root, write, fill, version }) {
  const lessons = readLessons(root);
  if (!lessons.length) return 0;
  const template = fs.readFileSync(path.join(root, TEMPLATE), 'utf8');
  const marked = new Marked({ gfm: true });
  const page = ({ title, description, content }) => fill(template
    .replaceAll('{{PAGE_TITLE}}', escape(title))
    .replaceAll('{{PAGE_DESCRIPTION}}', escape(description))
    .replace('{{PAGE_CONTENT}}', () => content));

  lessons.forEach((l, i) => {
    const app = APPS[l.meta.app];
    if (!app) throw new Error(`${l.file}: app must be one of ${Object.keys(APPS).join(', ')}`);
    const same = lessons.filter((x) => x.meta.app === l.meta.app);
    const k = same.indexOf(l);
    const prev = same[k - 1], next = same[k + 1];
    const navLink = (x, rel) => (x ? `<a class="btn small" href="${x.slug}.html" rel="${rel}">${rel === 'prev' ? '← ' : ''}${escape(x.meta.title)}${rel === 'next' ? ' →' : ''}</a>` : '<span></span>');
    const content = `
      <p class="crumbs"><a href="./">Lessons</a> › ${app.name} ${l.meta.order}</p>
      <h1>${escape(l.meta.title)}</h1>
      <p class="meta"><img src="../icons/${app.icon}.svg" alt="">${app.name} lesson ${l.meta.order}${l.meta.time ? ` · ${escape(l.meta.time)}` : ''} · written for ${app.name} ${version(app.dir)} · <a href="${app.open}" target="_blank" rel="noopener">Open ${app.name}</a></p>
      <article class="lesson">${marked.parse(l.body)}</article>
      <nav class="pager" aria-label="Lessons">${navLink(prev, 'prev')}${navLink(next, 'next')}</nav>`;
    write(`learn/${l.slug}.html`, page({ title: `${l.meta.title} — ${app.name} lesson ${l.meta.order}`, description: l.meta.summary || '', content }));
  });

  // the list of lessons
  const list = Object.entries(APPS).map(([key, app]) => {
    const mine = lessons.filter((l) => l.meta.app === key);
    if (!mine.length) return '';
    return `<section class="lesson-list"><h2><img src="../icons/${app.icon}.svg" alt="">${app.name}</h2><ol>${mine.map((l) =>
      `<li><a href="${l.slug}.html">${escape(l.meta.title)}</a>${l.meta.time ? ` <span class="time">${escape(l.meta.time)}</span>` : ''}<br><span class="summary">${escape(l.meta.summary || '')}</span></li>`).join('')}</ol></section>`;
  }).join('');
  write('learn/index.html', page({
    title: 'Lessons — LinkLab and CamLab',
    description: 'Step-by-step lessons for LinkLab and CamLab.',
    content: `<h1>Lessons</h1><p class="lead">Step-by-step lessons, each with numbers to check your work against. Every lesson is written for the current version of the app.</p>${list}`,
  }));

  // pictures and the files a lesson links to (starting designs)
  for (const sub of ['img', 'files']) {
    const dir = path.join(root, TUTORIAL_DIR, sub);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) write(`learn/${sub}/${f}`, fs.readFileSync(path.join(dir, f)));
  }
  return lessons.length;
}
