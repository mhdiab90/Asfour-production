/**
 * The approved Phase 1 Step 8C-5 additions to files that earlier steps pin as
 * unchanged against HEAD.
 *
 * Step 8C-5 adds three production record types (thermal_concrete, tunnel_kiln,
 * handmade_brick). That adds exactly one marked block to each of these files -
 * a collection name, a stage config, a duplicate identity - and nothing else.
 * A pinned file passes when removing its marked block gives back HEAD exactly,
 * so any other change (an existing stage, a field, a query) still fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** file -> [block start marker, text the block ends before]. */
export const STEP_8C5_APPROVED_BLOCKS: Readonly<Record<string, readonly [string, string]>> = {
  'src/services/stageQueryBoundsPure.ts': ['  // Phase 1 Step 8C-5: the remaining production areas, one new collection each.\n', '};'],
  'src/services/genericStageDuplicateIdentityPure.ts': ['  // Phase 1 Step 8C-5 - same shape as mortar: product + batch / order number.\n', '};'],
  'src/utils/productionCalculations.ts': ['  // Phase 1 Step 8C-5: the remaining production areas.\n', '};'],
  'src/services/productionStageConfig.ts': ['\n  /*\n   * Phase 1 Step 8C-5 - the remaining production areas.', '};\n\nexport function getStageConfig'],
};

function headOf(root: string, file: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
}

/** The working file with its approved 8C-5 block removed (or unchanged when it has none). */
export function withoutStep8C5Block(file: string, text: string): string {
  const block = STEP_8C5_APPROVED_BLOCKS[file];
  if (!block) return text;
  const start = text.indexOf(block[0]);
  if (start < 0) return text;
  const end = text.indexOf(block[1], start);
  if (end < 0) return text;
  return text.slice(0, start) + text.slice(end);
}

/**
 * Like `git diff --name-only HEAD -- <files>`, but a file whose only change is
 * its approved Step 8C-5 block is not listed.
 */
export function changedBeyondStep8C5(root: string, files: readonly string[]): string {
  const changed: string[] = [];
  for (const file of files) {
    const head = headOf(root, file);
    const full = path.join(root, file);
    if (head === null) {
      if (fs.existsSync(full)) changed.push(file);
      continue;
    }
    if (!fs.existsSync(full)) {
      changed.push(file);
      continue;
    }
    const working = fs.readFileSync(full, 'utf-8').replace(/\r\n/g, '\n');
    if (working !== head && withoutStep8C5Block(file, working) !== head) changed.push(file);
  }
  return changed.join('\n');
}

/** The eight stages every earlier step pinned, and the three Step 8C-5 added after them. */
export const PRE_8C5_STAGES = ['pressing', 'rotary_furnace', 'chinese_mills', 'tube_ball_mills', 'mortar_concrete', 'mixing', 'lightweight_foam', 'sorting'] as const;
export const STEP_8C5_STAGES = ['thermal_concrete', 'tunnel_kiln', 'handmade_brick'] as const;
export const STEP_8C5_COLLECTIONS: Readonly<Record<string, string>> = {
  thermal_concrete: 'stage_thermal_concrete',
  tunnel_kiln: 'stage_tunnel_kiln',
  handmade_brick: 'stage_handmade_brick',
};
