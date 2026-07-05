// data-fire dashboard Vite 配置
// 设计：React 插件用于 JSX 快刷新；dev server 把 /api 前缀代理到后端 8000，避免跨域。
// 生产用 VITE_API_BASE 环境变量指向真实后端地址。

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// dev 模式下前端跑在 5173，后端跑在 8000。用 proxy 把 /api 转发过去，
// 这样前端代码里 fetch('/api/sessions/...') 就能直连后端，浏览器不会拦跨域。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
