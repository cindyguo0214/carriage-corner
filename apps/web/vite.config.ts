import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    // 開發時同源連到即時伺服器（apps/server，預設 :5189）
    proxy: {
      '/socket.io': { target: 'http://127.0.0.1:5189', ws: true },
      // 車票分享：簽章 API、落地頁、OG 預覽圖
      // 保留原本的 Host，讓落地頁的 og:image 指向前端網址而不是 :5189
      '/api': { target: 'http://127.0.0.1:5189', changeOrigin: false, xfwd: true },
      '^/t/': { target: 'http://127.0.0.1:5189', changeOrigin: false, xfwd: true },
      '^/og/': { target: 'http://127.0.0.1:5189', changeOrigin: false, xfwd: true },
    },
  },
});
