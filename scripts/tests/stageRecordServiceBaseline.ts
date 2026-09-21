/**
 * The approved baseline of src/services/stageRecordService.ts for the tests that
 * pin it as unchanged (Phase 1 Steps 1E, 2A, 3, 4, 5A, 5B, 7A, 8).
 * Step 8C-5 adds the approved new-stage entries listed below.
 *
 * The file must equal HEAD with exactly the Step 8A unit-label correction applied
 * (one import + the Data Review list `unit` line). Any other difference - a write
 * path, a query, a calculation, a field name - still fails those tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FILE = 'src/services/stageRecordService.ts';

/** [text at HEAD, approved replacement] - each must occur exactly once at HEAD. */
export const STEP_8A_APPROVED_STAGE_RECORD_CHANGES: ReadonlyArray<readonly [string, string]> = [
  [
    "import { runCacheFirstRead } from './localCacheStore';\n",
    "import { runCacheFirstRead } from './localCacheStore';\nimport { stageListQuantityUnit } from './uomReadinessPure';\n",
  ],
  [
    "          unit: st === 'sorting' || st === 'pressing' ? 'قطعة' : st === 'chinese_mills' ? 'شيكارة' : 'طن',\n",
    "          // Phase 1 Step 8A: the unit of the field `quantity` came from (label only - numbers unchanged).\n          unit: stageListQuantityUnit(st, d),\n",
  ],
  // Phase 1 Step 8C-5 (approved): the three new record types are named, read by
  // the unified query, and hand-made brick is measured like pressing (pieces).
  [
    "  sorting: 'الفرز والمراقبة',\n};\n",
    "  sorting: 'الفرز والمراقبة',\n  thermal_concrete: 'الخرسانة الحرارية',\n  tunnel_kiln: 'الفرن النفقي',\n  handmade_brick: 'الطوب اليدوي',\n};\n",
  ],
  [
    "        'lightweight_foam',\n        'sorting'\n      ];\n",
    "        'lightweight_foam',\n        'sorting',\n        'thermal_concrete',\n        'tunnel_kiln',\n        'handmade_brick'\n      ];\n",
  ],
  [
    "        if (st === 'pressing') {\n",
    "        // Phase 1 Step 8C-5: hand-made brick is measured like pressing (pieces x piece weight).\n        if (st === 'pressing' || st === 'handmade_brick') {\n",
  ],
];

/**
 * '' when stageRecordService.ts is HEAD plus only the approved Step 8A change
 * (or plain HEAD); otherwise the file path, like `git diff --name-only`.
 */
export function stageRecordServiceChangedBeyondApproved(root: string): string {
  const head = execFileSync('git', ['show', `HEAD:${FILE}`], { cwd: root, encoding: 'utf-8' }).replace(/\r\n/g, '\n');
  const working = fs.readFileSync(path.join(root, FILE), 'utf-8').replace(/\r\n/g, '\n');
  if (working === head) return '';
  let approved = head;
  for (const [from, to] of STEP_8A_APPROVED_STAGE_RECORD_CHANGES) {
    if (approved.split(from).length !== 2) return FILE;
    approved = approved.replace(from, to);
  }
  return working === approved ? '' : FILE;
}
