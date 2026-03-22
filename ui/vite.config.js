import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7778',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@xterm')) return 'xterm'
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('react')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },
})
