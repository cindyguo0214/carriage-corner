import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `vite build --mode artifact`：發布成 claude.ai Artifact 用的靜態版（相對路徑、離線模式），
// 輸出到 dist-artifact/，再由 scripts/artifact-page.mjs 轉成 Artifact 頁面格式。
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: mode === 'artifact' ? './' : '/',
  build: { outDir: mode === 'artifact' ? 'dist-artifact' : 'dist' },
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    proxy: {
      // 開發時同源連到即時伺服器（apps/server，預設 :5189）
      '/socket.io': { target: 'http://127.0.0.1:5189', ws: true },
      // 車票分享：簽章 API、落地頁、OG 預覽圖；保留原本的 Host，讓 og:image 指向前端網址
      '/api': { target: 'http://127.0.0.1:5189', changeOrigin: false, xfwd: true },
      '^/t/': { target: 'http://127.0.0.1:5189', changeOrigin: false, xfwd: true },
      '^/og/': { target: 'http://127.0.0.1:5189', changeOrigin: false, xfwd: true },
    },
  },
}));
