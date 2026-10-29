// End-to-end tests in a real browser (Stage 9). Run: npm run test:e2e
// Builds the app, starts the production server, and runs e2e/*.spec.ts in Chromium.
// First time on a new machine: npx playwright install chromium
import { defineConfig, devices } from "@playwright/test";

const PORT = 3900;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
