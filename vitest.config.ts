import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the '@' alias wxt generates (.wxt/tsconfig.json), so runtime
    // '@/...' imports resolve under Vitest too.
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
});
