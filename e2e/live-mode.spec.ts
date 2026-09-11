import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";

/**
 * Live mode must refuse demo access and demand a real secret. These tests boot
 * separate servers with different environments.
 */
const PORT_MISCONFIGURED = 3106;
const PORT_LIVE = 3107;

function startServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn("pnpm", ["exec", "next", "start", "-p", String(port)], { env: { ...process.env, ...env }, stdio: "pipe" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 60_000);
    child.stdout?.on("data", (d) => {
      if (String(d).includes("Ready")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
}

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "environment behaviour is viewport independent");

test("live mode without AUTH_SECRET is a configuration error, not a demo fallback", async ({ page }) => {
  fs.rmSync("./data/e2e-live-bad.db", { force: true });
  const child = await startServer(PORT_MISCONFIGURED, { FINANCE_DESK_MODE: "live", AUTH_SECRET: "", FINANCE_DESK_DB: "./data/e2e-live-bad.db" });
  try {
    await page.goto(`http://localhost:${PORT_MISCONFIGURED}/sign-in`);
    await expect(page.getByRole("heading", { name: "Configuration needed" })).toBeVisible();
    await expect(page.getByText(/Live mode requires AUTH_SECRET/)).toBeVisible();
    await expect(page.getByTestId("persona-will")).toHaveCount(0);
  } finally {
    child.kill();
  }
});

test("live mode uses password accounts, rejects demo personas, and scopes spaces", async ({ page, request }) => {
  fs.rmSync("./data/e2e-live.db", { force: true });
  const child = await startServer(PORT_LIVE, { FINANCE_DESK_MODE: "live", AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret", FINANCE_DESK_DB: "./data/e2e-live.db" });
  const base = `http://localhost:${PORT_LIVE}`;
  try {
    await page.goto(`${base}/sign-in`);
    await expect(page.getByTestId("mode-badge")).toHaveText("Live data");
    await expect(page.getByTestId("persona-will")).toHaveCount(0);
    // Unauthenticated API access is refused.
    const res = await request.get(`${base}/api/export`);
    expect(res.status()).toBe(401);

    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Your first name").fill("Will");
    await page.getByLabel("Your role").fill("CEO");
    await page.getByLabel("Email").fill("will@example.com");
    await page.getByLabel(/Password/).fill("a-long-passphrase-123");
    await page.getByLabel("Company name").fill("Will & Arielle Studio");
    await page.getByLabel("Partner's first name").fill("Arielle");
    await page.getByLabel("Partner's role").fill("Creative Director");
    await page.getByRole("button", { name: "Create workspace" }).click();
    await page.waitForURL((u) => u.pathname === "/");
    await expect(page.getByTestId("mode-badge").first()).toHaveText("Live data");
    await expect(page.getByTestId("briefing")).toContainText(/Will/);
    // The partner's personal space exists but is not visible to Will; the template imposes no budgets.
    await page.goto(`${base}/money`);
    await expect(page.getByTestId("tab-partner")).toHaveText("Arielle's summary");
    await page.goto(`${base}/money?space=household`);
    await expect(page.getByTestId("household-company-paid")).toContainText("Two Teslas");
    await expect(page.getByTestId("household-company-paid")).toContainText("$5,800");
    await page.goto(`${base}/money?space=company`);
    await expect(page.getByTestId("subscriptions")).toContainText("tier to confirm");
    await expect(page.getByTestId("metric-recorded-cash")).toContainText("Unknown");

    await page.goto(`${base}/settings`);
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL(/sign-in/);
    await page.getByLabel("Email").fill("will@example.com");
    await page.getByLabel("Password").fill("wrong-password-123");
    await page.locator("form").getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  } finally {
    child.kill();
  }
});
