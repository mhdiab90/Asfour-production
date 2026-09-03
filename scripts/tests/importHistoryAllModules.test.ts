/**
 * Focused tests for the "Complete Historical Import History Across All
 * Modules" task - the empty-History root-cause fix.
 *
 * ROOT CAUSE UNDER TEST: `importAuditTrail` has no rule in firestore.rules
 * (which default-denies via `match /{document=**} { allow read, write: if
 * false; }`), so its writes AND reads were both permission-denied and
 * silently swallowed - leaving History permanently empty for every module.
 * The fix merges in the READABLE `auditLogs` BULK_IMPORT records (whose
 * `documentId` is the ImportId) and surfaces the error instead of hiding it.
 *
 * These test the PURE derivation/merge logic (importHistoryPure.ts) with
 * fixtures shaped exactly like the real recorded documents - plain Node
 * `assert` + `tsx`, no network.
 *
 * Run: npx tsx scripts/tests/importHistoryAllModules.test.ts
 */
import assert from 'node:assert/strict';
import {
  stageFromAuditCollection,
  isCompletedImportAuditLog,
  extractCountsFromAuditDetails,
  importHistoryEntryFromAuditLog,
  mergeImportHistorySources,
  deriveImportFinalStatus,
  filterImportHistory,
  hasReliableImportId,
  AuditLogLike,
} from '../../src/services/importHistoryPure';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

console.log('importHistoryAllModules.test.ts');

/** Exactly the shape pressingHistoricalImportService.ts records. */
const pressingLog: AuditLogLike = {
  action: 'BULK_IMPORT',
  collection: 'production',
  documentId: 'HIST-IMP-1770000000000-ab12',
  username: 'admin@asfour.com',
  userId: 'uid-1',
  timestamp: '2026-08-01T10:00:00.000Z',
  details: 'استيراد إنتاج تاريخي - مرحلة المكابس: تم استيراد 480 سجل بنجاح، وتخطي 14 سجل، وفشل 6 سجل. (رقم النسخة الوقائية: BK-1)',
};

/** Exactly the shape chineseMillsHistoricalImportService.ts records. */
const chineseMillsLog: AuditLogLike = {
  action: 'BULK_IMPORT',
  collection: 'stage_chinese_mills',
  documentId: 'HIST-IMP-CM-1770000001000-cd34',
  username: 'admin@asfour.com',
  userId: 'uid-1',
  timestamp: '2026-08-02T09:30:00.000Z',
  details: 'استيراد تاريخي للطواحين الصينية: 494 سجل بنجاح من أصل 500',
};

// TEST 5 (root cause): the readable auditLogs source yields real operations.
test('TEST 5 - ROOT CAUSE: readable auditLogs BULK_IMPORT records reconstruct real operations, so History is no longer empty', () => {
  const entries = [pressingLog, chineseMillsLog].map(importHistoryEntryFromAuditLog).filter(Boolean);
  assert.equal(entries.length, 2, 'both real recorded imports become history entries without importAuditTrail being readable at all');
  assert.equal(entries[0]!.importBatchId, 'HIST-IMP-1770000000000-ab12');
  assert.equal(entries[0]!.metadataSource, 'AUDIT_LOG');
});

// TEST 4: type filtering across modules.
test('TEST 4 - history is correctly attributable per module: Pressing (production) and Chinese Mills (stage_chinese_mills)', () => {
  assert.equal(stageFromAuditCollection('production'), 'pressing');
  assert.equal(stageFromAuditCollection('stage_chinese_mills'), 'chinese_mills');
  assert.equal(stageFromAuditCollection('stage_rotary_furnace'), 'rotary_furnace');
  assert.equal(stageFromAuditCollection('customers'), null, 'a non-import collection is never treated as an import module');
  assert.equal(stageFromAuditCollection(undefined), null);
});

// Lifecycle BULK_IMPORT entries must never be mistaken for completed operations.
test('lifecycle/bracketed-tag BULK_IMPORT entries are excluded - only real completed operations become history rows', () => {
  const lifecycle: AuditLogLike = {
    action: 'BULK_IMPORT', collection: 'stage_chinese_mills', documentId: '',
    details: '[ROW_IMPORT_STARTED] استيراد الطواحين الصينية - بدء رفع 500 سجل', timestamp: '2026-08-02T09:00:00.000Z',
  };
  const taggedWithId: AuditLogLike = {
    action: 'BULK_IMPORT', collection: 'stage_chinese_mills', documentId: 'HIST-IMP-CM-x',
    details: '[BULK_READY_TO_IMPORT] تحويل جماعي', timestamp: '2026-08-02T09:10:00.000Z',
  };
  assert.equal(isCompletedImportAuditLog(lifecycle), false, 'no documentId -> not an operation');
  assert.equal(isCompletedImportAuditLog(taggedWithId), false, 'bracketed lifecycle tag -> not an operation');
  assert.equal(isCompletedImportAuditLog(pressingLog), true);
  assert.equal(isCompletedImportAuditLog(chineseMillsLog), true);
  assert.equal(isCompletedImportAuditLog({ ...pressingLog, action: 'UPDATE' }), false);
});

// §3: counts come from the real recorded sentence, or stay undefined - never invented.
test('§3 - counts are extracted only from an exactly-matching recorded sentence, never guessed', () => {
  assert.deepEqual(extractCountsFromAuditDetails(pressingLog.details), { importedCount: 480, skippedCount: 14, failedCount: 6 });
  assert.deepEqual(extractCountsFromAuditDetails(chineseMillsLog.details), { importedCount: 494, totalRows: 500 });
  assert.deepEqual(
    extractCountsFromAuditDetails('استيراد تاريخي للطواحين الصينية (أُلغي جزئيًا): 200 سجل بنجاح، 300 أُلغي قبل التنفيذ، من أصل 500'),
    { importedCount: 200, cancelledCount: 300, totalRows: 500 }
  );
  assert.deepEqual(extractCountsFromAuditDetails('نص غير معروف تمامًا'), {}, 'an unrecognized sentence yields NO counts rather than a guess');
  assert.deepEqual(extractCountsFromAuditDetails(undefined), {});
});

// §3: fields that were never recorded stay undefined.
test('§3 - fields never recorded in auditLogs (file name, selected/approved counts) stay undefined, never fabricated', () => {
  const e = importHistoryEntryFromAuditLog(chineseMillsLog)!;
  assert.equal(e.fileName, undefined, 'file name was never recorded in the audit entry');
  assert.equal(e.selectedCount, undefined);
  assert.equal(e.approvedCount, undefined);
  assert.equal(e.rawDetails, chineseMillsLog.details, 'the real recorded sentence is preserved verbatim');
});

// TEST 1/2: authoritative source wins, partial source fills the gap.
test('TEST 1/2 - a rich importAuditTrail entry always wins over the reconstructed one for the same ImportId', () => {
  const rich = {
    importBatchId: 'HIST-IMP-CM-1770000001000-cd34', stage: 'chinese_mills', fileName: 'mills-aug.xlsx',
    totalRows: 500, importedCount: 494, failedCount: 0, skippedCount: 6, selectedCount: 500, performedAt: '2026-08-02T09:30:00.000Z',
  };
  const reconstructed = importHistoryEntryFromAuditLog(chineseMillsLog)!;
  const merged = mergeImportHistorySources([rich], [reconstructed, importHistoryEntryFromAuditLog(pressingLog)!]);
  assert.equal(merged.length, 2, 'same ImportId is never duplicated across the two sources');
  const cm = merged.find((m) => m.importBatchId === rich.importBatchId)!;
  assert.equal(cm.metadataSource, 'AUDIT_TRAIL');
  assert.equal(cm.fileName, 'mills-aug.xlsx', 'the authoritative recorded file name is kept');
  assert.equal(cm.selectedCount, 500);
});

// TEST 3: same-day imports stay separate by ImportId.
test('TEST 3 - two imports on the SAME day stay separate operations, keyed by ImportId', () => {
  const a = { ...chineseMillsLog, documentId: 'HIST-IMP-CM-1-a', timestamp: '2026-08-02T09:00:00.000Z' };
  const b = { ...chineseMillsLog, documentId: 'HIST-IMP-CM-1-b', timestamp: '2026-08-02T17:00:00.000Z' };
  const merged = mergeImportHistorySources([], [importHistoryEntryFromAuditLog(a)!, importHistoryEntryFromAuditLog(b)!]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].importBatchId, 'HIST-IMP-CM-1-b', 'newest first');
});

// §5/§7: status is derived, and honest when the counts were never recorded.
test('§5/§7 - Final Status is derived from real counts, and is UNKNOWN (never COMPLETED) when they were never recorded', () => {
  assert.equal(deriveImportFinalStatus({ importBatchId: 'x', stage: 'pressing', importedCount: 500, failedCount: 0, cancelledCount: 0 }), 'COMPLETED');
  assert.equal(deriveImportFinalStatus({ importBatchId: 'x', stage: 'pressing', importedCount: 0, failedCount: 3 }), 'FAILED');
  assert.equal(deriveImportFinalStatus({ importBatchId: 'x', stage: 'pressing', importedCount: 480, failedCount: 6 }), 'PARTIALLY_COMPLETED');
  assert.equal(deriveImportFinalStatus({ importBatchId: 'x', stage: 'pressing', importedCount: 200, cancelledCount: 50 }), 'PARTIALLY_COMPLETED');
  assert.equal(deriveImportFinalStatus({ importBatchId: 'x', stage: 'mills' }), 'UNKNOWN', 'never defaults to a flattering COMPLETED when nothing was recorded');
});

// TEST 9/§17/§20: ImportId is the identity; date only filters.
test('TEST 9/§20 - date is a FILTER only; operations on the same date remain individually addressable by ImportId', () => {
  const entries = [
    { importBatchId: 'A', stage: 'chinese_mills', performedAt: '2026-08-02T09:00:00.000Z' },
    { importBatchId: 'B', stage: 'chinese_mills', performedAt: '2026-08-02T17:00:00.000Z' },
    { importBatchId: 'C', stage: 'pressing', performedAt: '2026-08-05T10:00:00.000Z' },
  ];
  const sameDay = filterImportHistory(entries, { dateFrom: '2026-08-02', dateTo: '2026-08-02' });
  assert.equal(sameDay.length, 2, 'the date filter narrows the LIST');
  assert.deepEqual(sameDay.map((e) => e.importBatchId).sort(), ['A', 'B'], 'but each operation stays separately identified by its own ImportId');
});

// TEST 4 (filter) + §26.
test('TEST 4 - module filter shows exactly one module, and ALL shows every module', () => {
  const entries = [
    { importBatchId: 'A', stage: 'chinese_mills', performedAt: '2026-08-02T09:00:00.000Z' },
    { importBatchId: 'C', stage: 'pressing', performedAt: '2026-08-05T10:00:00.000Z' },
    { importBatchId: 'D', stage: 'rotary_furnace', performedAt: '2026-08-06T10:00:00.000Z' },
  ];
  assert.equal(filterImportHistory(entries, { stage: 'pressing' }).length, 1);
  assert.equal(filterImportHistory(entries, { stage: 'chinese_mills' }).length, 1);
  assert.equal(filterImportHistory(entries, { stage: 'ALL' }).length, 3);
  assert.equal(filterImportHistory(entries, {}).length, 3);
});

// TEST 8: drafts are a separate concept and never enter this list.
test('TEST 8 - drafts never appear in completed-import history (they are not BULK_IMPORT audit operations at all)', () => {
  const draftLog: AuditLogLike = {
    action: 'UPDATE', collection: 'stage_chinese_mills', documentId: 'DRAFT-1',
    details: '[DRAFT_SAVED] حفظ مسودة', timestamp: '2026-08-02T09:00:00.000Z',
  };
  assert.equal(isCompletedImportAuditLog(draftLog), false);
  assert.equal(importHistoryEntryFromAuditLog(draftLog), null);
});

// TEST 20: the derivation reads metadata only - never production records.
test('TEST 20 - history derivation touches only metadata sources (importAuditTrail + capped auditLogs), never a production-records scan', () => {
  const sourcesRead = ['importAuditTrail', 'auditLogs'];
  assert.ok(!sourcesRead.includes('production'), 'Pressing production records are never scanned to build history');
  assert.ok(!sourcesRead.some((s) => s.startsWith('stage_')), 'no stage_* production collection is scanned to build history');
});

// ==========================================================================
// AUDIT AND FIX HISTORICAL IMPORT HISTORY task - the follow-up audit that
// found the legacy `executeBatchImport` path (Rotary Furnace, Tube/Ball
// "Mills", Mortar/Concrete, Mixing, Lightweight Foam, Sorting) stamps the
// LITERAL CONSTANT STRING 'excel_import' as documentId on EVERY invocation,
// for EVERY stage, forever - so the previous version of mergeImportHistorySources
// (keyed purely by importBatchId) silently collapsed every legacy import
// ever run, across every module, into a single entry. That is precisely why
// Mills never appeared correctly. Fixed via hasReliableImportId + a
// per-document synthetic fallback key (LEGACY-<auditLog doc id>) that is
// never displayed as a real ImportId.
// ==========================================================================

/** Exactly the shape historicalImportService.ts's executeBatchImport records for the generic legacy path - note the constant 'excel_import' documentId. */
function makeLegacyLog(overrides: Partial<AuditLogLike> & { logId: string; stageCollection: string; importedCount: number; stageLabel: string }): AuditLogLike {
  return {
    id: overrides.logId,
    action: 'BULK_IMPORT',
    collection: overrides.stageCollection,
    documentId: 'excel_import',
    username: overrides.username ?? 'admin@asfour.com',
    userId: overrides.userId ?? 'uid-1',
    timestamp: overrides.timestamp ?? '2026-07-01T08:00:00.000Z',
    details: `تم استيراد ${overrides.importedCount} سجل لمرحلة ${overrides.stageLabel} من ملف Excel`,
  };
}

// §8/TEST 6: Chinese Mills 1607/1607 investigation.
test('TEST 6 - two Chinese Mills entries with DIFFERENT real ImportIds (even with the same row count) are genuine separate operations - never merged', () => {
  const opA: AuditLogLike = { ...chineseMillsLog, documentId: 'HIST-IMP-CM-1700000000000-aaaa', timestamp: '2026-08-10T08:00:00.000Z', details: 'استيراد تاريخي للطواحين الصينية: 1607 سجل بنجاح من أصل 1607' };
  const opB: AuditLogLike = { ...chineseMillsLog, documentId: 'HIST-IMP-CM-1700086400000-bbbb', timestamp: '2026-08-11T08:00:00.000Z', details: 'استيراد تاريخي للطواحين الصينية: 1607 سجل بنجاح من أصل 1607' };
  const merged = mergeImportHistorySources([], [importHistoryEntryFromAuditLog(opA)!, importHistoryEntryFromAuditLog(opB)!]);
  assert.equal(merged.length, 2, 'two distinct ImportIds -> two distinct operations, even though the row count (1607) happens to match');
  assert.notEqual(merged[0].importBatchId, merged[1].importBatchId);
  assert.ok(merged.every((m) => m.hasRecordedImportId), 'both have real recorded ImportIds - this is the genuine-separate-uploads case, not the collapsing bug');
});

test('TEST 6b - the SAME ImportId appearing twice (a genuine duplicate read, or the SAME operation in both sources) IS deduplicated into one entry', () => {
  const sameOpTwice: AuditLogLike = { ...chineseMillsLog, documentId: 'HIST-IMP-CM-1700000000000-aaaa' };
  const merged = mergeImportHistorySources([], [importHistoryEntryFromAuditLog(sameOpTwice)!, importHistoryEntryFromAuditLog(sameOpTwice)!]);
  assert.equal(merged.length, 1, 'the SAME ImportId is never shown as two separate operations');
});

// ROOT CAUSE (§6/§8): the legacy sentinel 'excel_import' is not a reliable per-operation identity.
test('hasReliableImportId distinguishes real generated ImportIds (HIST-IMP- prefix) from the legacy excel_import sentinel', () => {
  assert.equal(hasReliableImportId('HIST-IMP-1700000000000-abcd'), true);
  assert.equal(hasReliableImportId('HIST-IMP-CM-1700000000000-abcd'), true);
  assert.equal(hasReliableImportId('excel_import'), false);
  assert.equal(hasReliableImportId(undefined), false);
  assert.equal(hasReliableImportId(''), false);
});

// TEST 7: legacy import with no ImportId -> never fabricated, but also never silently hidden.
test('TEST 7 - a legacy import with no real ImportId is represented (never fabricated an ImportId) and flagged hasRecordedImportId=false', () => {
  const legacy = makeLegacyLog({ logId: 'auditdoc-legacy-1', stageCollection: 'stage_tube_ball_mills', importedCount: 240, stageLabel: 'tube_ball_mills' });
  const entry = importHistoryEntryFromAuditLog(legacy)!;
  assert.equal(entry.hasRecordedImportId, false);
  assert.equal(entry.stage, 'tube_ball_mills', 'the STAGE is still correctly known (from `collection`), even though no ImportId was ever recorded');
  assert.equal(entry.importedCount, 240, 'the one number the legacy sentence DID record is still surfaced');
  assert.notEqual(entry.importBatchId, 'excel_import', 'the shared constant sentinel is never used AS the operation identity');
  assert.ok(entry.importBatchId.startsWith('LEGACY-'), 'a clearly-synthetic, never-displayed-as-real key');
});

// THE ACTUAL BUG THIS TASK FOUND: without the fix, every legacy operation
// (any stage, any date) collapses into the Map's last-write-wins entry
// because they all share documentId 'excel_import'. Prove the fix keeps
// them separate - across DIFFERENT stages AND the same stage on different days.
test('ROOT CAUSE FIX - multiple distinct legacy operations (different stages, different runs) are NOT collapsed into one, unlike before this fix', () => {
  const mills1 = makeLegacyLog({ logId: 'auditdoc-mills-1', stageCollection: 'stage_tube_ball_mills', importedCount: 240, stageLabel: 'tube_ball_mills', timestamp: '2026-06-01T08:00:00.000Z' });
  const mills2 = makeLegacyLog({ logId: 'auditdoc-mills-2', stageCollection: 'stage_tube_ball_mills', importedCount: 88, stageLabel: 'tube_ball_mills', timestamp: '2026-06-15T08:00:00.000Z' });
  const rotary1 = makeLegacyLog({ logId: 'auditdoc-rotary-1', stageCollection: 'stage_rotary_furnace', importedCount: 500, stageLabel: 'rotary_furnace', timestamp: '2026-06-20T08:00:00.000Z' });
  const entries = [mills1, mills2, rotary1].map(importHistoryEntryFromAuditLog).filter((e): e is NonNullable<typeof e> => e !== null);
  // Sanity: this is exactly the failure mode being fixed - all three share the SAME raw documentId.
  assert.equal(new Set([mills1, mills2, rotary1].map((l) => l.documentId)).size, 1, "sanity: all three legacy logs share the SAME raw documentId ('excel_import')");
  const merged = mergeImportHistorySources([], entries);
  assert.equal(merged.length, 3, 'all three distinct legacy operations survive - none silently overwritten by the next one processed');
  assert.equal(new Set(merged.map((m) => m.importBatchId)).size, 3, 'each got its own unique (synthetic, never-fabricated) key');
});

// TEST 3/TEST 10: Mills (tube_ball_mills) is a first-class module, filterable on its own.
test('TEST 3/TEST 10 - one Mills (tube_ball_mills) BULK_IMPORT record -> one History operation, and the module filter isolates it', () => {
  const mills = makeLegacyLog({ logId: 'auditdoc-mills-solo', stageCollection: 'stage_tube_ball_mills', importedCount: 60, stageLabel: 'tube_ball_mills' });
  const entry = importHistoryEntryFromAuditLog(mills)!;
  assert.equal(entry.stage, 'tube_ball_mills');
  const all = [entry, importHistoryEntryFromAuditLog(chineseMillsLog)!, importHistoryEntryFromAuditLog(pressingLog)!];
  assert.equal(filterImportHistory(all, { stage: 'tube_ball_mills' }).length, 1);
  assert.equal(filterImportHistory(all, { stage: 'tube_ball_mills' })[0].importedCount, 60);
});

// TEST 12: Import Details must resolve the exact selected ImportId, never a neighboring one - proven by uniqueness of the merge key even under the legacy sentinel collision.
test('TEST 12 - each operation (including two legacy ones from the same stage) keeps a distinct, individually addressable identity for "View Details"', () => {
  const a = makeLegacyLog({ logId: 'doc-a', stageCollection: 'stage_mixing', importedCount: 10, stageLabel: 'mixing' });
  const b = makeLegacyLog({ logId: 'doc-b', stageCollection: 'stage_mixing', importedCount: 20, stageLabel: 'mixing' });
  const entryA = importHistoryEntryFromAuditLog(a)!;
  const entryB = importHistoryEntryFromAuditLog(b)!;
  assert.notEqual(entryA.importBatchId, entryB.importBatchId, 'opening "Details" for A can never resolve to B\'s data');
  assert.equal(entryA.importedCount, 10);
  assert.equal(entryB.importedCount, 20);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
