import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/customer': {
        target: 'http://localhost:3010',
        changeOrigin: true,
      },
    },
  },
});
