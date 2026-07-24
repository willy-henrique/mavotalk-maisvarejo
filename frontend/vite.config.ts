import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiOrigin =
      env.VITE_API_BASE_URL || env.VITE_API_ORIGIN || 'http://localhost:4002';
    return {
      server: {
        port: 4001,
        host: '0.0.0.0',
        proxy: {
          '/api': { target: apiOrigin, changeOrigin: true },
          '/socket.io': { target: apiOrigin, ws: true },
        },
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
