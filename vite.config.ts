import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // Only the API part of a Review's path goes to the Desk; Vite still serves
      // the client for `/r/<id>` itself, so development runs the same URL shape
      // production does and the base-deriving code is exercised here too.
      '^/r/[^/]+/api': { target: 'http://localhost:4317', ws: true },
    },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./tests/helpers/galley-home.ts'],
  },
})
