import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    // We intentionally do NOT inject GEMINI_API_KEY into the client bundle
    // anymore. All Gemini calls go through the /api/* serverless handlers,
    // which read the key from process.env on the server. loadEnv is kept in
    // case future client-only env vars (with the VITE_ prefix) are needed.
    loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
