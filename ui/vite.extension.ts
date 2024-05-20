import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: '../',
    copyPublicDir: false,
    lib: {
      name: 'AgentSchedulerHysli',
      entry: 'src/extension/index.ts',
      fileName: 'javascript/agent-scheduler-hysli',
      formats: ['iife'],
    },
  },
});
