// =============================================================================
// notices.mjs — generate THIRD_PARTY_NOTICES.md
// -----------------------------------------------------------------------------
// Lists every RUNTIME dependency (the ones shipped inside the apps) with its
// licence text. Build-only tools such as esbuild are not shipped, so they are
// not listed. Run:  npm run notices   (the build also runs it).
// Only permissive licences are allowed; anything else stops the build.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Apache-2.0', '0BSD', 'Zlib'];

export function generateNotices() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});
  const entries = [];
  for (const name of deps) {
    const dir = path.join(ROOT, 'node_modules', name);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (!ALLOWED.includes(meta.license)) {
      throw new Error(`Dependency ${name} uses licence "${meta.license}", which is not on the allowed list.`);
    }
    const licFile = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
    const text = licFile ? fs.readFileSync(path.join(dir, licFile), 'utf8').trim() : `Licence: ${meta.license}`;
    entries.push({ name, version: meta.version, license: meta.license, text });
  }
  let md = '# Third-party notices\n\n';
  if (entries.length === 0) {
    md += 'The apps currently include **no third-party code**. Everything shipped is original work.\n\n'
        + 'Build tools (such as esbuild, MIT licence) are used only to produce the files and are not included in them.\n';
  } else {
    md += 'The apps include the following third-party components:\n\n';
    for (const e of entries) md += `## ${e.name} ${e.version} (${e.license})\n\n\`\`\`\n${e.text}\n\`\`\`\n\n`;
  }
  fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), md);
  return entries;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const e = generateNotices();
  console.log(`THIRD_PARTY_NOTICES.md written (${e.length} runtime dependencies).`);
}
