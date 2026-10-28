import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://rugby_admin:rugby_admin@localhost:5433/rugby_test',
      APP_DATABASE_URL: process.env.TEST_APP_DATABASE_URL ?? 'postgres://rugby_app:rugby_app@localhost:5433/rugby_test',
      STORAGE_DIR: './.data/test-storage',
      MFA_OBLIGATOIRE: '0',
    },
    globalSetup: './test/setup.ts',
    testTimeout: 30000,
    fileParallelism: false,
  },
});
