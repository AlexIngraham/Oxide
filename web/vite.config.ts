import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    // Freeze Vite's current Baseline Widely Available browser set instead of
    // allowing a dependency update to silently raise the support floor.
    target: ['chrome111', 'edge111', 'firefox114', 'safari16.4'],
    assetsInlineLimit(filePath) {
      // Keep WASM as a separately cached application/wasm response even if a
      // future optimized binary falls below Vite's normal inline threshold.
      return filePath.endsWith('.wasm') ? false : undefined
    },
  },
})
