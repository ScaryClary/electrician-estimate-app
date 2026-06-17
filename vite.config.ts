import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev-only proxies for direct SDK usage (keys from .env.local)
      '/hcp-api': {
        target: 'https://api.housecallpro.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hcp-api/, ''),
      },
      '/openai-api': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/openai-api/, ''),
      },
    },
  },
})
