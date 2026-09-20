import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端构建产物输出到 web/dist，由后端 Express 一并托管
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
