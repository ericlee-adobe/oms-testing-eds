import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const loginEntry = resolve(projectRoot, 'src/blocks/login/index.jsx');

if (!existsSync(loginEntry)) {
  throw new Error(`Missing React entry point: ${loginEntry}`);
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(projectRoot, 'blocks'),
    emptyOutDir: false,
    sourcemap: true,

    // Vite 8 uses Rolldown.
    rolldownOptions: {
      // Keep the entry's `export default decorate` so AEM's loadBlock can call it.
      preserveEntrySignatures: 'strict',
      input: {
        login: loginEntry,
      },
      output: {
        entryFileNames: '[name]/[name].js',
        chunkFileNames: 'shared/[name]-[hash].js',
        assetFileNames: 'shared/[name][extname]',
      },
    },
  },
});