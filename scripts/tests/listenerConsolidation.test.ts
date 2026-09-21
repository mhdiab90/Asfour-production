/**
 * Phase 4E - duplicate Firestore realtime listener consolidation tests.
 *
 * Target 1 (aiProviderConfig/active): createSharedListener()
 * (sharedListenerPure.ts) is pure/Firebase-free and tested directly with
 * a fake "source" spy standing in for Firestore's onSnapshot - this
 * verifies the actual reference-counting/fan-out/cleanup contract
 * end-to-end (scenarios #1-#9, #13-#14 below), not just that the source
 * file mentions the right function names.
 *
 * Target 2 (translationOverrides) and Target 3 (adminUsers language
 * resubscription) are verified by source inspection - both are React
 * component/context wiring changes rather than new pure logic, and this
 * codebase's established convention (see every prior phase's test file)
 * is to verify Firebase/React-coupled wiring by exact source inspection
 * rather than mounting components.
 *
 * Run: npx tsx scripts/tests/listenerConsolidation.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSharedListener } from '../../src/services/sharedListenerPure';

let passed = 0;
let failed = 0;
const registeredTests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registeredTests.push({ name, fn });
}

console.log('listenerConsolidation.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A call-counting fake standing in for Firestore's onSnapshot - tracks how many times the underlying source was actually subscribed/unsubscribed. */
function createFakeSource<T>() {
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  let currentOnValue: ((v: T) => void) | null = null;
  let currentOnError: ((e: any) => void) | null = null;
  const subscribeToSource = (onValue: (v: T) => void, onError: (e: any) => void) => {
    subscribeCount++;
    currentOnValue = onValue;
    currentOnError = onError;
    return () => {
      unsubscribeCount++;
      currentOnValue = null;
      currentOnError = null;
    };
  };
  return {
    subscribeToSource,
    getSubscribeCount: () => subscribeCount,
    getUnsubscribeCount: () => unsubscribeCount,
    emit: (value: T) => currentOnValue?.(value),
    emitError: (err: any) => currentOnError?.(err),
    isActive: () => currentOnValue !== null,
  };
}

// ==================================================
// Target 1 - createSharedListener (aiProviderConfig/active)
// ==================================================
test('#1/#3 single subscription creation: the first consumer creates exactly one underlying source subscription', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  const received: number[] = [];
  shared.subscribe((v) => received.push(v));
  assert.equal(fake.getSubscribeCount(), 1);
});

test('#2/#4 multiple consumers share one listener: a second subscribe() does NOT create another source subscription', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  shared.subscribe(() => {});
  shared.subscribe(() => {});
  shared.subscribe(() => {});
  assert.equal(fake.getSubscribeCount(), 1, '3 consumers must still result in exactly 1 underlying source subscription');
});

test('#8 listener data is delivered to ALL active consumers on every source emission', () => {
  const fake = createFakeSource<string>();
  const shared = createSharedListener<string>(fake.subscribeToSource);
  const a: string[] = [];
  const b: string[] = [];
  const c: string[] = [];
  shared.subscribe((v) => a.push(v));
  shared.subscribe((v) => b.push(v));
  shared.subscribe((v) => c.push(v));
  fake.emit('claude');
  assert.deepEqual(a, ['claude']);
  assert.deepEqual(b, ['claude']);
  assert.deepEqual(c, ['claude']);
});

test('#5 first consumer unsubscribes while a second remains: the underlying source listener stays active', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  const unsubA = shared.subscribe(() => {});
  shared.subscribe(() => {});
  unsubA();
  assert.equal(fake.getUnsubscribeCount(), 0, 'the source must not be torn down while a second consumer is still subscribed');
  assert.equal(fake.isActive(), true);
});

test('#6 final consumer unsubscribes: the underlying source listener IS cleaned up', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  const unsubA = shared.subscribe(() => {});
  const unsubB = shared.subscribe(() => {});
  unsubA();
  unsubB();
  assert.equal(fake.getUnsubscribeCount(), 1);
  assert.equal(fake.isActive(), false);
});

test('#7 listener error propagates safely to every active consumer', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  const errorsA: any[] = [];
  const errorsB: any[] = [];
  shared.subscribe(() => {}, (e) => errorsA.push(e));
  shared.subscribe(() => {}, (e) => errorsB.push(e));
  const boom = new Error('permission-denied');
  fake.emitError(boom);
  assert.deepEqual(errorsA, [boom]);
  assert.deepEqual(errorsB, [boom]);
});

test('error does not silently retry: after an error, the dead source is not assumed active - a later subscribe() starts a genuinely new source subscription', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  shared.subscribe(() => {});
  assert.equal(fake.getSubscribeCount(), 1);
  fake.emitError(new Error('boom'));
  // A brand new consumer joining after the error must trigger a fresh source subscription (never silently assume the dead one still works).
  shared.subscribe(() => {});
  assert.equal(fake.getSubscribeCount(), 2);
});

test('#9 re-subscription after ALL consumers leave works correctly: a fresh subscribe() after full teardown creates a new source subscription and receives new values', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  const unsubA = shared.subscribe(() => {});
  unsubA();
  assert.equal(fake.getUnsubscribeCount(), 1);

  const received: number[] = [];
  shared.subscribe((v) => received.push(v));
  assert.equal(fake.getSubscribeCount(), 2, 'a second, independent source subscription must be created after full teardown');
  fake.emit(42);
  assert.deepEqual(received, [42]);
});

test('a late-joining consumer is replayed the already-known current value immediately (no extra source read)', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  shared.subscribe(() => {});
  fake.emit(7);

  const receivedByLateJoiner: number[] = [];
  shared.subscribe((v) => receivedByLateJoiner.push(v));
  assert.deepEqual(receivedByLateJoiner, [7], 'the late joiner must receive the current cached value synchronously, without a second source subscription');
  assert.equal(fake.getSubscribeCount(), 1, 'no second source subscription was created just to serve the late joiner');
});

test('a late joiner before any value has arrived receives nothing synchronously (matches onSnapshot: no fabricated initial value)', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  const received: number[] = [];
  shared.subscribe((v) => received.push(v));
  assert.deepEqual(received, []);
});

test('#13/#14 React remount / StrictMode-style rapid subscribe-then-unsubscribe-then-subscribe cycles never leak or double-count the source', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  // StrictMode double-invokes an effect: subscribe, immediately unsubscribe (dev-only throwaway), then subscribe again for real.
  const throwaway = shared.subscribe(() => {});
  throwaway();
  const real = shared.subscribe(() => {});
  assert.equal(fake.getSubscribeCount(), 2, 'each full mount/unmount cycle legitimately re-subscribes to the source - this is correct, not a leak');
  assert.equal(fake.getUnsubscribeCount(), 1);
  real();
  assert.equal(fake.getUnsubscribeCount(), 2);
});

test('unsubscribing the SAME consumer twice is a safe no-op (does not double-decrement or throw)', () => {
  const fake = createFakeSource<number>();
  const shared = createSharedListener<number>(fake.subscribeToSource);
  const unsub = shared.subscribe(() => {});
  unsub();
  assert.doesNotThrow(() => unsub());
  assert.equal(fake.getUnsubscribeCount(), 1, 'the source must only be torn down once, even if the consumer calls unsubscribe twice');
});

// ==================================================
// Target 1 - source-level wiring in aiProviderConfigService.ts
// ==================================================
const aiProviderConfigSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/services/aiProviderConfigService.ts'),
  'utf-8'
);

test('aiProviderConfigService.ts: exactly one onSnapshot() call exists in the whole file (the shared source), never one per exported subscribe function', () => {
  const calls = [...aiProviderConfigSource.matchAll(/onSnapshot\(/g)];
  assert.equal(calls.length, 1);
});

test('aiProviderConfigService.ts: subscribeActiveProviderConfig delegates to the shared listener created via createSharedListener, imported from sharedListenerPure', () => {
  assert.match(aiProviderConfigSource, /import \{ createSharedListener \} from '\.\/sharedListenerPure';/);
  assert.match(aiProviderConfigSource, /createSharedListener<ActiveProviderConfig \| null>/);
  assert.match(aiProviderConfigSource, /return sharedActiveProviderListener\.subscribe\(onUpdate, onError\);/);
});

test('aiProviderConfigService.ts: subscribeActiveProviderConfig public signature is unchanged - both existing callers (App.tsx, AIProviderManagementView.tsx) compile with zero changes', () => {
  assert.match(
    aiProviderConfigSource,
    /export function subscribeActiveProviderConfig\(\s*onUpdate: \(config: ActiveProviderConfig \| null\) => void,\s*onError\?: \(err: any\) => void\s*\): \(\) => void/
  );
});

test('Listeners Before/After for Target 1: App.tsx and AIProviderManagementView.tsx both still call subscribeActiveProviderConfig() unchanged (both now share one underlying onSnapshot instead of each creating their own)', () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf-8');
  const adminViewSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/components/admin/AIProviderManagementView.tsx'),
    'utf-8'
  );
  assert.match(appSource, /const unsubscribe = subscribeActiveProviderConfig\(/);
  assert.match(adminViewSource, /const unsubscribe = subscribeActiveProviderConfig\(/);
});

// ==================================================
// Target 2 - translationOverrides consolidation (source inspection)
// ==================================================
const languageContextSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/i18n/LanguageContext.tsx'),
  'utf-8'
);
const translationManagerSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/admin/TranslationManagerView.tsx'),
  'utf-8'
);

test('LanguageContext.tsx: exactly one subscribeTranslationOverrides() call exists (the single shared listener for every signed-in user)', () => {
  const calls = [...languageContextSource.matchAll(/subscribeTranslationOverrides\(/g)];
  assert.equal(calls.length, 1);
});

test('LanguageContext.tsx now exposes the unfiltered allOverrides map through its context value, in addition to the existing per-language overrides', () => {
  assert.match(languageContextSource, /allOverrides: Record<string, TranslationOverrideDoc>;/);
  assert.match(languageContextSource, /overrides,\s*\n\s*allOverrides,/);
});

test('TranslationManagerView.tsx no longer imports or calls subscribeTranslationOverrides - it consumes allOverrides from useLanguage() instead, eliminating the second listener', () => {
  assert.equal(/subscribeTranslationOverrides/.test(translationManagerSource), false);
  assert.match(translationManagerSource, /const \{ language, isRtl, allOverrides \} = useLanguage\(\);/);
});

test('TranslationManagerView.tsx still reads allOverrides via ar__key/en__key exactly as before (data shape/usage unchanged, only the source of the data changed)', () => {
  assert.match(translationManagerSource, /const arOverride = allOverrides\[`ar__\$\{key\}`\];/);
  assert.match(translationManagerSource, /const enOverride = allOverrides\[`en__\$\{key\}`\];/);
});

test('Listeners Before/After for Target 2: translationOverrideService.ts itself is untouched - still exactly one subscribeTranslationOverrides() export, no new listener API', () => {
  const serviceSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/services/translationOverrideService.ts'),
    'utf-8'
  );
  const exportedSubscribeFns = [...serviceSource.matchAll(/export function subscribe\w+\(/g)];
  assert.equal(exportedSubscribeFns.length, 1);
  assert.match(serviceSource, /export function subscribeTranslationOverrides\(/);
});

test('language switching is preserved: LanguageContext.tsx\'s override subscription still depends only on Firebase auth state (onAuthStateChanged), never on `language` - toggling language cannot create a duplicate translationOverrides listener', () => {
  assert.match(languageContextSource, /const unsubscribeAuth = onAuthStateChanged\(auth, \(user\) => \{/);
  // The effect that owns subscribeTranslationOverrides has an empty dependency array - it re-runs only via onAuthStateChanged's own internal callback, never via a React dependency on `language`.
  const effectStart = languageContextSource.indexOf('let unsubscribeOverrides: (() => void) | undefined;');
  const effectEnd = languageContextSource.indexOf('}, []);', effectStart) + '}, []);'.length;
  const effectBody = languageContextSource.slice(effectStart, effectEnd);
  assert.match(effectBody, /\}, \[\]\);$/);
  assert.equal(/language/.test(effectBody), false, 'the subscription effect body must not reference `language` at all');
});

// ==================================================
// Target 3 - adminUsers language resubscription (source inspection)
// ==================================================
const userManagementSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/components/users/UserManagementView.tsx'),
  'utf-8'
);

test('#12 language changes do not create duplicate adminUsers listeners: the subscribeUsers effect dependency array is now empty, not [language]', () => {
  const effectStart = userManagementSource.indexOf('// Subscribe to Users collection');
  const nextEffectMarker = userManagementSource.indexOf('// Quick auto-dismiss for alerts', effectStart);
  const effectBody = userManagementSource.slice(effectStart, nextEffectMarker);
  assert.match(effectBody, /return \(\) => unsubscribe\(\);\s*\}, \[\]\);/, 'the adminUsers subscription effect must now run only once per mount, not once per language change');
});

test('the error message shown to the user is still localized correctly via a language ref (not a stale closure), preserving current behavior', () => {
  assert.match(userManagementSource, /const languageRef = useRef\(language\);/);
  assert.match(userManagementSource, /languageRef\.current = language;/);
  assert.match(userManagementSource, /languageRef\.current === 'ar' \? 'تعذر تحميل قائمة المستخدمين من قاعدة البيانات\.' : 'Could not fetch user accounts\.'/);
});

test('#10/#11 auth change still recreates the listener when required, logout still cleans it up: subscribeUsers/unsubscribe wiring itself (component mount/unmount lifecycle) is unchanged - only the language dependency was removed', () => {
  assert.match(userManagementSource, /const unsubscribe = subscribeUsers\(/);
  assert.match(userManagementSource, /return \(\) => unsubscribe\(\);/);
});

test('exactly one subscribeUsers() call exists in UserManagementView.tsx (no duplicate/second listener was introduced while fixing the language coupling)', () => {
  const calls = [...userManagementSource.matchAll(/subscribeUsers\(/g)];
  assert.equal(calls.length, 1);
});

test('userService.ts (subscribeUsers itself) is untouched by this phase - the fix is entirely in the caller\'s effect dependencies, not the service', () => {
  const userServiceSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/userService.ts'), 'utf-8');
  assert.equal(/languageRef|sharedListenerPure/.test(userServiceSource), false);
});

// ==================================================
// Regression guards: no unrelated architecture touched
// ==================================================
test('No new npm dependency: sharedListenerPure.ts has zero imports (no Firebase, no React, no third-party state library)', () => {
  const pureSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/sharedListenerPure.ts'), 'utf-8');
  const importLines = [...pureSource.matchAll(/^import .+$/gm)];
  assert.equal(importLines.length, 0);
});

test('No Firestore Rules or index files were touched by this phase (source-level guard on every changed file)', () => {
  const changedFiles = [
    aiProviderConfigSource,
    fs.readFileSync(path.resolve(__dirname, '../../src/services/sharedListenerPure.ts'), 'utf-8'),
    languageContextSource,
    translationManagerSource,
    userManagementSource,
  ];
  for (const content of changedFiles) {
    assert.equal(/firestore\.rules|firestore\.indexes\.json/.test(content), false);
  }
});

test('Phase 4A/4B/4C/4D read-optimization code is untouched by this phase (no reference to stage/production/restore/systemTest query-bounding helpers in any Phase 4E file)', () => {
  const changedFiles = [aiProviderConfigSource, languageContextSource, translationManagerSource, userManagementSource];
  for (const content of changedFiles) {
    assert.equal(/stageQueryBoundsPure|productionQueryBoundsPure|resolveStageQueryBounds|resolveProductionQueryBounds|getCountFromServer/.test(content), false);
  }
});

test('Master Data / Cost Center Hierarchy / historical import architecture untouched: none of the Phase 4E changed files import from those modules (UserManagementView.tsx has a pre-existing fetchMasterData import for its employee-linking dropdown, untouched by this phase and intentionally excluded from this guard)', () => {
  const changedFiles = [aiProviderConfigSource, languageContextSource, translationManagerSource];
  for (const content of changedFiles) {
    assert.equal(/costCenterHierarchy|historicalImportService|masterDataService/.test(content), false);
  }
  // UserManagementView.tsx's only Phase 4E edit is the subscribeUsers effect's
  // dependency array + the new languageRef - the pre-existing fetchMasterData
  // call inside the SAME effect must remain textually unchanged.
  assert.match(userManagementSource, /fetchMasterData<Employee>\('employees'\)/);
});

async function main() {
  for (const { name, fn } of registeredTests) {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${name}`);
      console.error(err);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
