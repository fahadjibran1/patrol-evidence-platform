import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageJson = JSON.parse(
  readFileSync(path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'package.json'), 'utf8'),
) as {
  version?: string;
  buildId?: string;
};

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version ?? '1.0.0'),
    __APP_BUILD_ID__: JSON.stringify(packageJson.buildId ?? '2026.07.20.1'),
  },
  server: {
    port: 5173,
  },
});
