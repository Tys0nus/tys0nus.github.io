import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('shadergradient') || id.includes('@react-three') || id.includes('three')) {
            return 'bg-engine';
          }

          if (id.includes('@huggingface/transformers') || id.includes('onnxruntime')) {
            return 'llm-runtime';
          }
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
})
