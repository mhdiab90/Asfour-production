/**
 * THE MACHINE OF AN ODOO-IMPORTED RECORD (3.41.0): the work order's name -> a machine key, and the join.
 * Run: npx tsx scripts/tests/odooMachine.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0; let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => registered.push({ name, fn });
console.log('odooMachine.test.ts');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
let m: any;
async function bootstrap() { m = await load('src/services/odooMachinePure.ts'); }

test('K1. the Chinese mills are told apart by their number, whatever the spelling', () => {
  for (const n of [1, 2, 3, 4, 5]) assert.equal(m.odooMachineKey('chinese_mills', `الطاحونه الصينيه رقم ${n}`), `chinese_mills:${n}`);
  assert.equal(m.odooMachineKey('chinese_mills', 'الطاحونة الصيني 2'), 'chinese_mills:2', 'ة / ه and ي / ه variants');
  assert.equal(m.odooMachineKey('chinese_mills', 'الطاحونه الصينيه رقم ٣'), 'chinese_mills:3', 'Arabic-Indic digits');
});

test('K2. the ball mills and the tube mills are the two kinds Odoo names', () => {
  assert.equal(m.odooMachineKey('tube_ball_mills', 'الطواحين الكرويه ( بول ميل )'), 'tube_ball_mills:ball');
  assert.equal(m.odooMachineKey('tube_ball_mills', 'طواحين اسطوانيه (تيوب ميل )'), 'tube_ball_mills:tube');
});

test('K3. a name that does not say which machine gets no key - never guessed', () => {
  assert.equal(m.odooMachineKey('mixing', 'الخلاطات'), null);
  assert.equal(m.odooMachineKey('tunnel_kiln', 'الافران النفقية'), null);
  assert.equal(m.odooMachineKey('chinese_mills', 'الطاحونه الصينيه'), null, 'no number');
  assert.equal(m.odooMachineKey('rotary_furnace', 'كسارة رقم 12'), null, 'handled by the sub-centre, not a machine key');
  assert.equal(m.odooMachineKey('chinese_mills', ''), null);
});

const REC = (id: string, stageType: string, rawData: any) => ({ id, stageType, rawData } as any);

test('K4. the join stamps only Odoo records that have a work order, on copies', () => {
  const links = new Map([['a', { equipmentName: 'الطاحونه الصينيه رقم 4', raw: 'raw' }]]);
  const a = REC('a', 'chinese_mills', { manufacturingOrderNumber: 'MO/1' });
  const b = REC('b', 'chinese_mills', { manufacturingOrderNumber: 'MO/2' });
  const c = REC('a', 'chinese_mills', {});
  const out = m.attachOdooEquipment([a, b, c], links);
  assert.equal(out[0].rawData.odooMachineKey, 'chinese_mills:4');
  assert.equal(out[0].rawData.odooEquipmentName, 'الطاحونه الصينيه رقم 4');
  assert.equal(out[1], b, 'no link: returned as it was');
  assert.equal(out[2], c, 'not an Odoo record: returned as it was');
  assert.equal(a.rawData.odooMachineKey, undefined, 'the cached record is never mutated');
});

test('K5. the fetch joins the machines only when an Odoo record is present, reads only, and never fails the fetch', () => {
  const svc = read('src/services/stageRecordService.ts');
  const loader = svc.slice(svc.indexOf('async function loadOdooEquipmentLinks'), svc.indexOf('async function withOdooMachines'));
  assert.ok(/getDocs\(collection\(db, 'workOrders'\)\)/.test(loader));
  assert.equal(/setDoc|addDoc|updateDoc|deleteDoc|writeBatch|safeAddDoc|safeUpdateDoc/.test(loader), false, 'read-only');
  assert.ok(/return withOdooMachines\(results\);/.test(svc) && /records\.some\(\(r\) => \(r\.rawData as any\)\?\.manufacturingOrderNumber\)/.test(svc) && /return attachOdooEquipment\(records, await loadOdooEquipmentLinks\(\)\)/.test(svc));
  assert.ok(/ODOO_LINKS_TTL_MS/.test(svc), 'cached for a few minutes');
});

(async () => {
  await bootstrap();
  for (const { name, fn } of registered) {
    try { await fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (err: any) { console.log(`  FAIL  ${name}`); console.log(String(err?.message ?? err).split('\n').slice(0, 8).join('\n')); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
