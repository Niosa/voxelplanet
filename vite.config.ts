import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      // Required for SharedArrayBuffer (WASM threads via wasm-bindgen-rayon)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'esnext',
    // Keep WASM as a separate chunk for async loading
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ['@babylonjs/core'],
          'babylon-loaders': ['@babylonjs/loaders'],
        },
      },
    },
  },
  // Allow .wasm files to be fetched as assets
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
  },
});
