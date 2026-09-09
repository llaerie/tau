import { defineConfig, devices } from "@playwright/test";

const PORT = 3105;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: `rm -f ./data/e2e.db ./data/e2e.db-wal ./data/e2e.db-shm && FINANCE_DESK_MODE=demo FINANCE_DESK_DB=./data/e2e.db pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
