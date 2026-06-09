var _a;
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
var packageJson = JSON.parse(readFileSync(path.join(fileURLToPath(new URL('.', import.meta.url)), '..', 'package.json'), 'utf8'));
export default defineConfig({
    base: './',
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify((_a = packageJson.version) !== null && _a !== void 0 ? _a : 'dev'),
    },
    server: {
        port: 5173,
    },
});
