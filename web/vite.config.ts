import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The built site is plain files. `base: './'` lets the same build run from the Python
// server, from a folder, or from a sub-path on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/events': 'http://127.0.0.1:8765',
      '/api': 'http://127.0.0.1:8765',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
