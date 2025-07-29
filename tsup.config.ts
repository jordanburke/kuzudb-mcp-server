import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/server-core.ts', 'src/server-fastmcp.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  target: 'node22',
  outDir: 'dist',
  shims: true,
});