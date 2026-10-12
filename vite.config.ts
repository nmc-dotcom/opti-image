import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // ONNX Runtime Web locates its .wasm via `new URL(..., import.meta.url)`; pre-bundling would
    // move the JS into .vite/deps and break that relative URL in dev (production is unaffected).
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'es2022',
  },
})
