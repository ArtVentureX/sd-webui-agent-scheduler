import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: '../',
    copyPublicDir: false,
    lib: {
      name: 'agentScheduler',
      entry: 'src/extension/index.ts',
      fileName: 'javascript/agent-scheduler',
      formats: ['iife']
    },
  },
});
