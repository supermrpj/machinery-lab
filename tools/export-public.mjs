// =============================================================================
// export-public.mjs — copy the committed files into the public repository
// -----------------------------------------------------------------------------
//   node tools/export-public.mjs            → ./public/
//   node tools/export-public.mjs <folder>
//
// This repository keeps the full development history and some private notes.
// The public repository on GitHub is a separate git repository in public/
// (ignored here). This script makes public/ match the files committed in
// HEAD, leaving out those marked export-ignore in .gitattributes, and never
// touches public/.git. Then commit and push from public/ (docs/PUBLISHING.md).
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- CONFIG -------------------------------------------------------------------
const DEFAULT_DEST = 'public';
const KEEP = ['.git', 'node_modules', 'dist'];   // never removed: git, and the ignored install and build folders (removing them deletes thousands of files on OneDrive)
// -------------------------------------------------------------------------------

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const dest = path.resolve(ROOT, process.argv[2] || DEFAULT_DEST);
if (dest === ROOT || ROOT.startsWith(dest + path.sep)) throw new Error('The destination must be a separate folder.');

if (git('status', '--porcelain', '--untracked-files=no').trim()) {
  console.warn('note: there are uncommitted changes; only what is committed is copied.');
}

// committed files, minus export-ignore
const files = git('ls-tree', '-r', '-z', '--name-only', 'HEAD').split('\0').filter(Boolean);
const attrs = execFileSync('git', ['check-attr', '-z', '--stdin', 'export-ignore'], { cwd: ROOT, input: files.join('\0') + '\0', encoding: 'utf8' })
  .split('\0');
const ignored = new Set();
for (let i = 0; i + 2 < attrs.length; i += 3) if (attrs[i + 2] === 'set') ignored.add(attrs[i]);
const keep = files.filter((f) => !ignored.has(f));

// clear the destination (except .git), then copy the committed version of each file
fs.mkdirSync(dest, { recursive: true });
for (const e of fs.readdirSync(dest)) if (!KEEP.includes(e)) fs.rmSync(path.join(dest, e), { recursive: true, force: true });
for (const f of keep) {
  const out = path.join(dest, f);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, maxBuffer: 64 << 20 }));
}
console.log(`copied ${keep.length} files to ${path.relative(ROOT, dest) || dest} (left out ${ignored.size}: ${[...ignored].join(', ')})`);
console.log('Next: in that folder, git add -A, git commit, git push.');
