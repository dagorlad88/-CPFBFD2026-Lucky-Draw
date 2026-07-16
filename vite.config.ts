import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // DEV ONLY: proxy API + live-update stream to the Express/SQLite backend
      // (server.js). Not used in production — there server.js serves the built
      // app and /api from the same origin, so the frontend's relative "/api"
      // calls resolve to the deployed domain automatically.
      proxy: {
        '/api': {
          target: process.env.API_TARGET || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  };
});
