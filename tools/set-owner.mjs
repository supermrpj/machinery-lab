// =============================================================================
// set-owner.mjs — put your GitHub username (and repository name) into the files
// -----------------------------------------------------------------------------
//   npm run set-owner -- <github-username> [repository-name]
//
// The public files carry the placeholder GITHUB_USER and the repository name
// "linklab" until you run this once. It changes only the files in FILES.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- CONFIG -------------------------------------------------------------------
const PLACEHOLDER = 'GITHUB_USER';
const DEFAULT_REPO = 'linklab';
const FILES = ['package.json', 'NOTICE.md', 'README.md', 'CITATION.cff', '.github/FUNDING.yml'];
// -------------------------------------------------------------------------------

const [user, repo = DEFAULT_REPO] = process.argv.slice(2);
if (!user || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user)) {
  console.error('Usage: npm run set-owner -- <github-username> [repository-name]');
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]+$/.test(repo)) {
  console.error(`"${repo}" is not a valid repository name.`);
  process.exit(1);
}

let changed = 0;
for (const f of FILES) {
  const file = path.join(ROOT, f);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  let after = before.split(PLACEHOLDER).join(user);
  // repository name in URLs: github.com/<user>/<repo> and <user>.github.io/<repo>
  if (repo !== DEFAULT_REPO) {
    const u = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    after = after
      .replace(new RegExp(`(github\\.com/${u}/)${DEFAULT_REPO}\\b`, 'g'), `$1${repo}`)
      .replace(new RegExp(`(${u}\\.github\\.io/)${DEFAULT_REPO}\\b`, 'g'), `$1${repo}`);
  }
  if (after !== before) { fs.writeFileSync(file, after); changed++; console.log(`updated ${f}`); }
}
console.log(changed ? `Done: https://github.com/${user}/${repo}` : `Nothing to change (already set?).`);
