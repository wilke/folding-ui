import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/folding/',
  server: {
    port: 5173,
    proxy: {
      '/folding/api': {
        target: 'https://gowe.software-smithy.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/folding\/api/, '/api'),
        secure: true,
      },
      '/folding/auth': {
        target: 'https://user.patricbrc.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/folding\/auth/, ''),
        secure: true,
      },
      '/folding/ws-api': {
        target: 'https://p3.theseed.org/services/Workspace',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/folding\/ws-api/, ''),
        secure: true,
      },
    },
  },
});
