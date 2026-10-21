// =============================================================================
// build.mjs — build each app into ONE standalone HTML file, and the website
// -----------------------------------------------------------------------------
//   npm run build   → dist/LinkLab.html, dist/CamLab.html   (files for class)
//                   → dist/web/                             (the website)
//
// Steps for each app:
//   1. esbuild bundles and minifies apps/<app>/src/main.js (+ shared packages)
//   2. the CSS is minified
//   3. both are inlined into apps/<app>/index.html between the build markers
//   4. the copyright banner is added; third-party notices are regenerated
// The result opens by double-click and works offline.
//
// The website (dist/web/) is the landing page from site/, each app in its own
// folder with a web manifest (so it can be installed), the standalone files
// under download/, and a service worker (sw.js) that keeps a copy of the site
// for offline use. Links come from package.json (homepage, repository,
// funding); set your GitHub username once with  npm run set-owner -- <name>.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';
import { generateNotices } from './notices.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// ---- CONFIG -------------------------------------------------------------------
const APPS = [
  { dir: 'apps/linklab', out: 'LinkLab.html', name: 'LinkLab', web: 'app', icon: 'linklab', color: '#FFE11A',
    description: 'Draw linkages, watch them move and analyse their motion and forces.' },
  { dir: 'apps/camlab', out: 'CamLab.html', name: 'CamLab', web: 'camlab', icon: 'camlab', color: '#2196F3',
    description: 'Design disk cams: graphical method, SVAJ, sizing and forces.' },
];
const OUT_DIR = path.join(ROOT, 'dist');
const WEB_DIR = path.join(OUT_DIR, 'web');
const SITE_DIR = path.join(ROOT, 'site');
const DOWNLOADS = 'download';           // standalone files on the website (not kept offline)
const PLACEHOLDER = 'GITHUB_USER';      // replaced by tools/set-owner.mjs
const BACKGROUND = '#FFFDF2';           // splash colour of an installed app
// each app's own version, from its config.js (APP.version)
const appVersion = (dir) => (fs.readFileSync(path.join(ROOT, dir, 'src/config.js'), 'utf8').match(/version:\s*'([^']+)'/) || [, pkg.version])[1];
// -------------------------------------------------------------------------------

const repoUrl = String(pkg.repository?.url || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '');
const LINKS = { site: pkg.homepage, source: repoUrl, sponsor: pkg.funding, issues: pkg.bugs?.url };
const ownerSet = !JSON.stringify(LINKS).includes(PLACEHOLDER);
if (!ownerSet) console.warn('note: GitHub username not set yet (npm run set-owner -- <name>); the apps are built without links.');
const banner = (app) => `${app.name} ${appVersion(app.dir)} — Copyright (C) 2026 ${pkg.author}. Free software under the GNU GPL v3; see the About box.${ownerSet ? ` Source: ${repoUrl}` : ''}`;

fs.mkdirSync(OUT_DIR, { recursive: true });
generateNotices();
const notices = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const licence = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
const notice = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8');
const date = new Date().toISOString().slice(0, 10);
const built = {};   // app name → standalone HTML

for (const app of APPS) {
  const appDir = path.join(ROOT, app.dir);
  const js = await esbuild.build({
    entryPoints: [path.join(appDir, 'src/main.js')],
    bundle: true, minify: true, format: 'iife', target: ['es2020'],
    write: false, legalComments: 'none',
    define: {
      __BUILD_INFO__: JSON.stringify({ version: appVersion(app.dir), date, licence, notice, notices,
        links: ownerSet ? { site: LINKS.site, source: LINKS.source, sponsor: LINKS.sponsor } : {} }),
    },
  });
  const css = await esbuild.build({
    entryPoints: [path.join(appDir, 'src/ui/styles.css')],
    bundle: true, minify: true, write: false, loader: { '.css': 'css' },
  });
  let html = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  const jsCode = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  html = html
    .replace(/<!-- build:css -->[\s\S]*?<!-- \/build:css -->/, `<style>${css.outputFiles[0].text}</style>`)
    .replace(/<!-- build:js -->[\s\S]*?<!-- \/build:js -->/, () => `<script>${jsCode}</script>`)
    .replace('<html', `<!-- ${banner(app)} -->\n<html`);
  const outFile = path.join(OUT_DIR, app.out);
  fs.writeFileSync(outFile, html);
  built[app.name] = html;
  console.log(`built ${path.relative(ROOT, outFile)}  (${(html.length / 1024).toFixed(0)} KB)`);
}

// ---- website ------------------------------------------------------------------
fs.rmSync(WEB_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(WEB_DIR, DOWNLOADS), { recursive: true });
const write = (rel, data) => { const f = path.join(WEB_DIR, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

for (const app of APPS) {
  const html = built[app.name];
  write(`${DOWNLOADS}/${app.out}`, html);
  // the web copy can be installed (manifest, icons) and works offline (service worker)
  const head = [
    '<link rel="manifest" href="manifest.webmanifest">',
    `<meta name="theme-color" content="${app.color}">`,
    `<link rel="icon" href="../icons/${app.icon}.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="../icons/${app.icon}-apple-180.png">`,
    `<meta name="apple-mobile-web-app-title" content="${app.name}">`,
  ].join('\n');
  const sw = "<script>if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('../sw.js').catch(()=>{}))</script>";
  const end = html.lastIndexOf('</body>');
  const web = html.slice(0, end).replace('</head>', `${head}\n</head>`) + sw + '\n' + html.slice(end);
  write(`${app.web}/index.html`, web);
  write(`${app.web}/manifest.webmanifest`, JSON.stringify({
    name: app.name, short_name: app.name, description: app.description,
    start_url: './', scope: './', display: 'standalone',
    background_color: BACKGROUND, theme_color: app.color,
    icons: [
      { src: `../icons/${app.icon}-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `../icons/${app.icon}-512.png`, sizes: '512x512', type: 'image/png' },
      { src: `../icons/${app.icon}.svg`, sizes: 'any', type: 'image/svg+xml' },
    ],
  }, null, 2));
}

// landing page, icons and pictures from site/
const fill = (text) => text
  .replaceAll('{{LINKLAB_VERSION}}', appVersion('apps/linklab'))
  .replaceAll('{{CAMLAB_VERSION}}', appVersion('apps/camlab'))
  .replaceAll('{{SITE_URL}}', LINKS.site || '')
  .replaceAll('{{SOURCE_URL}}', LINKS.source || '')
  .replaceAll('{{ISSUES_URL}}', LINKS.issues || '')
  .replaceAll('{{SPONSOR_URL}}', LINKS.sponsor || '')
  .replaceAll('{{YEAR}}', date.slice(0, 4));
write('index.html', fill(fs.readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8')));
for (const sub of ['icons', 'img']) {
  for (const f of fs.readdirSync(path.join(SITE_DIR, sub))) write(`${sub}/${f}`, fs.readFileSync(path.join(SITE_DIR, sub, f)));
}

// service worker last: it lists every file of the site except the downloads
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else files.push(path.relative(WEB_DIR, f).split(path.sep).join('/'));
  }
})(WEB_DIR);
const kept = files.filter((f) => !f.startsWith(`${DOWNLOADS}/`)).sort();
const hash = crypto.createHash('sha256');
for (const f of kept) hash.update(f).update(fs.readFileSync(path.join(WEB_DIR, f)));
const urls = kept.map((f) => (f === 'index.html' ? './' : f.replace(/\/index\.html$/, '/')));
write('sw.js', fs.readFileSync(path.join(SITE_DIR, 'sw.js'), 'utf8')
  .replace('__CACHE__', `mlab-${hash.digest('hex').slice(0, 12)}`)
  .replace('__FILES__', JSON.stringify(urls, null, 2)));
const size = files.reduce((t, f) => t + fs.statSync(path.join(WEB_DIR, f)).size, 0);
console.log(`built dist/web  (${files.length + 1} files, ${(size / 1024).toFixed(0)} KB; ${kept.length} kept offline)`);
