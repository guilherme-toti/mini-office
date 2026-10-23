import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { createOfficeApi } from './src/server/api.ts';

/** Serves the office API from the Vite dev and preview servers, so one command runs it all. */
function officeApi(): Plugin {
  return {
    name: 'mini-office-api',
    configureServer(server) {
      server.middlewares.use(createOfficeApi());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createOfficeApi());
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), officeApi()],
  server: { host: '127.0.0.1', port: 5199 },
  preview: { host: '127.0.0.1', port: 5199 },
});
