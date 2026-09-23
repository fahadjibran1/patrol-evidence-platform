import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [react()],
    server: {
        port: 5174,
        proxy: {
            '/admin': {
                target: 'http://localhost:3010',
                changeOrigin: true,
            },
        },
    },
});
