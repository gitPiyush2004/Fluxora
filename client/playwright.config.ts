import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against a running stack with seeded demo data:
 *   npm run seed && npm run dev        (repo root; sign-in uses emailed links)
 *   npm run test:e2e -w client
 * Set E2E_BASE_URL to target another deployment.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Software WebGL so the 3D globe renders in headless Chromium.
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
