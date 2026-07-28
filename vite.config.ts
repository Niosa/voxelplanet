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
    // Keep WASM as a separate chunk for async loading.
    // Rolldown (Vite 8) requires manualChunks to be a function, not an object.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('@babylonjs/loaders')) return 'babylon-loaders';
          if (id.includes('@babylonjs/')) return 'babylon';
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
