import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { computeBuildIdentity, toVersionJson, toReleaseIdentity } from './scripts/buildIdentity.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Derives this build's identity from Git and makes it the ONE authoritative
 * source consumed by src/config/appVersion.ts, /version.json and the Service
 * Worker's cache name. Previously each of those carried its own hand-edited
 * copy, which drifted: production served commit 454291d while declaring
 * buildId '2026-08-22-001' and gitCommit 'main-v3.2.0' (a label, not a SHA).
 *
 * The version NUMBER is not touched here - it stays human-authored in
 * appVersion.ts, because bumping it is a product decision.
 */
function buildIdentityPlugin(): Plugin {
  const identity = computeBuildIdentity(__dirname);
  return {
    name: 'asfour-build-identity',
    config() {
      return {
        define: {
          __BUILD_VERSION__: JSON.stringify(identity.version),
          __BUILD_ID__: JSON.stringify(identity.buildId),
          __BUILD_COMMIT_SHA__: JSON.stringify(identity.commitSha),
          __BUILD_BRANCH__: JSON.stringify(identity.branch),
          __BUILD_TIMESTAMP__: JSON.stringify(identity.buildTimestamp),
          __BUILD_DEPLOYMENT_ID__: JSON.stringify(identity.deploymentId),
          __BUILD_TREE_CLEAN__: JSON.stringify(identity.treeClean),
        },
      };
    },
    /**
     * Runs after Vite has copied publicDir into outDir, so these overwrite the
     * checked-in development fallbacks rather than fighting them.
     */
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(outDir)) return;

      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify(toVersionJson(identity), null, 2) + '\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(outDir, 'release-identity.json'),
        JSON.stringify(toReleaseIdentity(identity), null, 2) + '\n',
        'utf-8',
      );

      // Give the Service Worker a cache name that changes with the release, so
      // a new deployment cannot be served from the previous build's cache. The
      // SW's strategy, offline behaviour and asset caching are untouched.
      const swPath = path.join(outDir, 'sw.js');
      if (fs.existsSync(swPath)) {
        const sw = fs.readFileSync(swPath, 'utf-8');
        const replaced = sw.replace(
          /const CACHE_VERSION = '[^']*';\s*\/\* __BUILD_IDENTITY__ \*\//,
          `const CACHE_VERSION = ${JSON.stringify(identity.buildId)};`,
        );
        if (replaced === sw) {
          throw new Error('[asfour-build-identity] sw.js is missing the __BUILD_IDENTITY__ marker - cache identity would silently stay stale');
        }
        fs.writeFileSync(swPath, replaced, 'utf-8');
      }
    },
  };
}

export default defineConfig(({ mode, command }) => {
  // Load .env / .env.local / .env.[mode] / .env.[mode].local (merged with
  // process.env, which takes priority) BEFORE building the `define` block below.
  // Previously this config read process.env.VITE_FIREBASE_* directly, which is
  // never populated by Vite's own .env.local loading - only loadEnv() reads
  // those files at config-evaluation time, so .env.local was silently ignored.
  const env = loadEnv(mode, process.cwd(), '');

  if (!env.VITE_FIREBASE_API_KEY) {
    // No secret values are logged - presence/absence only.
    const message =
      '[vite.config.ts] VITE_FIREBASE_API_KEY is MISSING. ' +
      'Set it in .env.local (see .env.example). Firebase Auth will fail to initialize until this is set.';

    // A production bundle built without the key is silently broken: getAuth()
    // throws auth/invalid-api-key while config/firebase.ts is still being
    // evaluated, so main.tsx never reaches createRoot().render() and the site
    // serves a white screen. Fail the build loudly here instead - `vite build`
    // is the only path that can ship such a bundle. `vite dev` keeps warning
    // rather than refusing to start, so local work on non-Firebase screens is
    // still possible without a key.
    if (command === 'build') {
      throw new Error(message);
    }
    console.error('\n' + message + '\n');
  }

  return {
    root: __dirname,
    plugins: [react(), tailwindcss(), buildIdentityPlugin()],
    define: {
      'import.meta.env.VITE_FIREBASE_API_KEY': JSON.stringify(env.VITE_FIREBASE_API_KEY || ''),
      'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': JSON.stringify(env.VITE_FIREBASE_AUTH_DOMAIN || 'asfourproduction-70e6e.firebaseapp.com'),
      'import.meta.env.VITE_FIREBASE_PROJECT_ID': JSON.stringify(env.VITE_FIREBASE_PROJECT_ID || 'asfourproduction-70e6e'),
      'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': JSON.stringify(env.VITE_FIREBASE_STORAGE_BUCKET || 'asfourproduction-70e6e.firebasestorage.app'),
      'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(env.VITE_FIREBASE_MESSAGING_SENDER_ID || '490935502022'),
      'import.meta.env.VITE_FIREBASE_APP_ID': JSON.stringify(env.VITE_FIREBASE_APP_ID || '1:490935502022:web:0681053f2cd09ff5a2c3c7'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
