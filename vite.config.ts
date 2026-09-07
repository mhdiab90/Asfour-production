import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    plugins: [react(), tailwindcss()],
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
