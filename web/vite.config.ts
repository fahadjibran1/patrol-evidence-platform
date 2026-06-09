import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageJson = JSON.parse(
  readFileSync(path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'package.json'), 'utf8'),
) as { version?: string };

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version ?? 'dev'),
  },
  server: {
    port: 5173,
  },
});
