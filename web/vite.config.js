var _a, _b;
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
        __APP_VERSION__: JSON.stringify((_a = packageJson.version) !== null && _a !== void 0 ? _a : '1.0.0'),
        __APP_BUILD_ID__: JSON.stringify((_b = packageJson.buildId) !== null && _b !== void 0 ? _b : '2026.07.20.1'),
    },
    server: {
        port: 5173,
    },
});
