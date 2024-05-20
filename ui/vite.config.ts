import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../',
    rollupOptions: {
      input: {
        main: 'index.html',
      },
    },
    lib: {
      name: 'agent-scheduler-hysli',
      entry: 'src/extension/index.ts',
      fileName: 'javascript/extension',
      formats: ['es'],
    },
  },
});
