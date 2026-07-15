import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:11434',
        changeOrigin: true,
      },
      // Browse the Ollama cloud model catalog without hitting browser CORS.
      // Production reverse proxies must mirror this: /ollama-www/* -> https://ollama.com/*
      '/ollama-www': {
        target: 'https://ollama.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama-www/, ''),
      }
    }
  }
})
