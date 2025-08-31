import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'KUZU_OAUTH_ENABLED=true KUZU_OAUTH_USERNAME=admin KUZU_OAUTH_PASSWORD=secret123 KUZU_OAUTH_USER_ID=oauth-admin KUZU_OAUTH_EMAIL=admin@example.com KUZU_OAUTH_ISSUER=http://localhost:3000 KUZU_OAUTH_RESOURCE=http://localhost:3000/mcp pnpm serve:test:http',
    url: 'http://localhost:3000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});