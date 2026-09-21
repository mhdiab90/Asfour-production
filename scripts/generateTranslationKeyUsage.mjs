#!/usr/bin/env node
/**
 * Translation Key Usage Map generator (§16 - "Used In: Production Entry,
 * Reports, Dashboard..." in the Translation Manager).
 *
 * Walks every .tsx/.ts file under src/, finds `t('some.key')` /
 * `t("some_key")` call sites, and records which files call each key. This
 * is a build-time/dev-time script (same category as
 * scripts/scanTranslationCoverage.mjs) - re-run it after adding new `t()`
 * call sites so the Translation Manager's "Used In" list stays accurate.
 * Output is committed as src/i18n/keyUsageMap.generated.json, which Vite
 * bundles as a plain JSON import - no runtime file-system access needed.
 *
 * Usage: node scripts/generateTranslationKeyUsage.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const OUT_FILE = path.join(SRC_DIR, 'i18n', 'keyUsageMap.generated.json');

const CALL_RE = /\bt\(\s*['"`]([A-Za-z0-9_.]+)['"`]/g;

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** Turns a source file path into a short human-readable screen label for the Translation Manager, e.g. "components/production/ProductionEntryForm.tsx" -> "Production Entry Form". */
function toScreenLabel(relPath) {
  const base = path.basename(relPath).replace(/\.(tsx|ts)$/, '');
  return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function main() {
  const files = walk(SRC_DIR, ['.tsx', '.ts']);
  const usage = {};

  for (const file of files) {
    const relPath = path.relative(ROOT, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');
    let match;
    const seenInFile = new Set();
    while ((match = CALL_RE.exec(content)) !== null) {
      const key = match[1];
      if (seenInFile.has(key)) continue;
      seenInFile.add(key);
      if (!usage[key]) usage[key] = [];
      usage[key].push({ file: relPath, screen: toScreenLabel(relPath) });
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(usage, null, 2) + '\n', 'utf8');
  console.log(`Wrote usage map for ${Object.keys(usage).length} translation key(s) -> ${path.relative(ROOT, OUT_FILE)}`);
}

main();
