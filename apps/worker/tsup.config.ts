import { defineConfig } from 'tsup';

// Workspace packages (@wi/*) ship TypeScript source, so they must be bundled into the output.
export default defineConfig({
  entry: ['src/worker.ts'],
  format: ['esm'],
  outDir: 'dist',
  noExternal: [/^@wi\//],
  clean: true,
});
