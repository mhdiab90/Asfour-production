#!/usr/bin/env node
/**
 * Language QA Scanner (§8 - PART 1 of the localization task).
 *
 * A heuristic, filesystem-level scanner (browsers/React cannot read their
 * own source files, so this must run in Node) that flags:
 *
 *   1. Arabic-only UI text detected in a JSX-bearing source line that is
 *      NOT guarded by the app's bilingual mechanisms (`language === 'ar'`
 *      ternary, or a `t('key')` dictionary lookup) - i.e. a line that will
 *      show Arabic even when the UI language is set to English.
 *   2. ar.ts / en.ts dictionary key-set mismatches (missing-in-Arabic /
 *      missing-in-English translations for the central `t()` dictionary).
 *
 * This is deliberately a heuristic (regex/line-window based), not a full
 * TSX AST analysis - it will have some false positives (e.g. a bilingual
 * ternary split across many lines, or Arabic text inside a plain string
 * constant that is never rendered) and can miss some real leaks. Treat its
 * output as a worklist to review, not an infallible gate. It is honest
 * about this in its own report footer.
 *
 * Usage: node scripts/scanTranslationCoverage.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

const ARABIC_RE = /[؀-ۿ]/;
const GUARD_RE = /language\s*===\s*['"]ar['"]|language\s*===\s*['"]en['"]|\bt\(\s*['"`]/;
const CONTEXT_WINDOW = 2; // lines above/below to also check for a guard (covers common multi-line ternaries)

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

function scanFileForUnguardedArabic(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (!ARABIC_RE.test(line)) continue;

    const windowStart = Math.max(0, i - CONTEXT_WINDOW);
    const windowEnd = Math.min(lines.length, i + CONTEXT_WINDOW + 1);
    const windowText = lines.slice(windowStart, windowEnd).join('\n');
    if (GUARD_RE.test(windowText)) continue; // guarded by ternary or t() nearby

    hits.push({ line: i + 1, text: trimmed.slice(0, 140) });
  }
  return hits;
}

function scanDictionaryParity() {
  const arPath = path.join(SRC_DIR, 'i18n', 'ar.ts');
  const enPath = path.join(SRC_DIR, 'i18n', 'en.ts');
  if (!fs.existsSync(arPath) || !fs.existsSync(enPath)) {
    return { ok: false, reason: 'ar.ts/en.ts not found at expected path', missingInEnglish: [], missingInArabic: [] };
  }
  const extractKeys = (src) => {
    const keys = new Set();
    const re = /^\s*([A-Za-z0-9_]+)\s*:/gm;
    let m;
    while ((m = re.exec(src)) !== null) keys.add(m[1]);
    return keys;
  };
  const arKeys = extractKeys(fs.readFileSync(arPath, 'utf8'));
  const enKeys = extractKeys(fs.readFileSync(enPath, 'utf8'));
  const missingInEnglish = [...arKeys].filter((k) => !enKeys.has(k));
  const missingInArabic = [...enKeys].filter((k) => !arKeys.has(k));
  return { ok: true, arKeyCount: arKeys.size, enKeyCount: enKeys.size, missingInEnglish, missingInArabic };
}

function main() {
  const asJson = process.argv.includes('--json');
  const tsxFiles = walk(SRC_DIR, ['.tsx']);

  const fileResults = [];
  let totalHits = 0;
  for (const file of tsxFiles) {
    const hits = scanFileForUnguardedArabic(file);
    if (hits.length > 0) {
      totalHits += hits.length;
      fileResults.push({ file: path.relative(ROOT, file), count: hits.length, hits });
    }
  }
  fileResults.sort((a, b) => b.count - a.count);

  const dictionary = scanDictionaryParity();

  const report = {
    scannedFiles: tsxFiles.length,
    totalSuspectLines: totalHits,
    filesWithSuspectLines: fileResults.length,
    topOffenders: fileResults.slice(0, 15).map((f) => ({ file: f.file, count: f.count })),
    dictionary,
  };

  if (asJson) {
    console.log(JSON.stringify({ ...report, fileResults }, null, 2));
    return;
  }

  console.log('=== ASFOUR ERP - Language QA Scanner ===\n');
  console.log(`Scanned ${report.scannedFiles} .tsx files under src/.`);
  console.log(`Dictionary (ar.ts/en.ts): ${dictionary.arKeyCount} Arabic keys, ${dictionary.enKeyCount} English keys.`);
  console.log(`  Missing in English: ${dictionary.missingInEnglish.length}${dictionary.missingInEnglish.length ? ' -> ' + dictionary.missingInEnglish.slice(0, 10).join(', ') : ''}`);
  console.log(`  Missing in Arabic:  ${dictionary.missingInArabic.length}${dictionary.missingInArabic.length ? ' -> ' + dictionary.missingInArabic.slice(0, 10).join(', ') : ''}`);
  console.log(`\nSuspected unguarded Arabic-only UI lines: ${report.totalSuspectLines} across ${report.filesWithSuspectLines} file(s).\n`);
  console.log('Top offending files:');
  for (const f of report.topOffenders) {
    console.log(`  ${String(f.count).padStart(4)}  ${f.file}`);
  }
  console.log(
    '\nNote: this is a heuristic line-window scanner, not a full TSX AST analysis - it can ' +
    'both over-flag (e.g. a bilingual ternary split across more than 2 lines) and under-flag ' +
    '(e.g. Arabic text assigned to a variable that happens to sit near an unrelated `t(` call). ' +
    'Use its output as a review worklist, not an automatic pass/fail gate.'
  );
}

main();
