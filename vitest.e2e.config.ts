import { defineConfig } from 'vitest/config';

// Volledige test tegen het echte Supabase-project (.env.production.local + E2E_STARTCODE).
export default defineConfig({
  mode: 'production', // laadt .env.production.local (Supabase); dev blijft demo
  test: { include: ['e2e/**/*.e2e.ts'], testTimeout: 120_000, hookTimeout: 300_000, fileParallelism: false },
});
