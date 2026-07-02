import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@monaco-editor') || id.includes('node_modules/monaco-editor')) {
            return 'monaco-vendor'
          }
          if (id.includes('node_modules/katex')) {
            return 'katex-vendor'
          }
          if (id.includes('node_modules/react-router-dom')) {
            return 'router-vendor'
          }
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor'
          }
          return undefined
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5174',
    },
  },
})
