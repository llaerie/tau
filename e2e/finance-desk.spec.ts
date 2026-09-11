import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, resetDemo, signIn, signOut } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, "will");
  await resetDemo(page);
  await page.close();
});

test("overview keeps spaces separate and marks unknowns honestly", async ({ page }) => {
  await signIn(page, "will");
  await expect(page.getByRole("heading", { name: /Good to see you, Will/ })).toBeVisible();
  await expect(page.getByTestId("cash-company")).toContainText("known so far");
  await expect(page.getByTestId("cash-household")).toContainText("$6,718");
  await expect(page.getByTestId("cash-personal")).toContainText("Will");
  await expect(page.getByText("Anticipated monthly revenue", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Company revenue, not take-home")).toBeVisible();
  await expect(page.getByText("The household plan is short by $930 a month")).toBeVisible();
  await expect(page.getByText(/business vs household split/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("company page explains provenance and keeps unknown costs unknown", async ({ page }) => {
  await signIn(page, "will");
  await page.goto("/company");
  const distributable = page.getByTestId("metric-company-distributable");
  await expect(distributable).toContainText("$15,350");
  await expect(distributable).toContainText("3 unknown");
  await distributable.getByRole("button", { name: "Where this comes from" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("revenue − committed");
  await expect(dialog).toContainText("Upper bound only");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Employer payroll cost rate not set", { exact: true })).toBeVisible();
  await expect(page.locator("dl").filter({ hasText: "Planned distribution to household" })).toContainText("$6,000");
  await expectNoHorizontalOverflow(page);
});

test("personal spaces are private: Will cannot open Arielle's space, Arielle can", async ({ page }) => {
  await signIn(page, "will");
  const res = await page.goto("/personal/sp_demo_arielle");
  expect(res?.status()).toBe(404);
  await signOut(page);
  await signIn(page, "arielle");
  await page.goto("/personal/sp_demo_arielle");
  await expect(page.getByRole("heading", { name: "Arielle" })).toBeVisible();
  const willRes = await page.goto("/personal/sp_demo_will");
  expect(willRes?.status()).toBe(404);
});

test("Arielle's take-home funds the travel goal first and the spending plan is checked against what is left", async ({ page }) => {
  await signIn(page, "arielle");
  await page.goto("/personal/sp_demo_arielle");
  // $3,000 gross − 7.65% FICA − $250 income-tax estimate = $2,520.50
  await expect(page.getByTestId("metric-personal-net")).toContainText("$2,521");
  await expect(page.getByTestId("metric-personal-available")).toContainText("$1,461");
  await expect(page.getByRole("row", { name: /^1 Friends travel/ })).toContainText("Fully funded");
  await expect(page.getByTestId("metric-personal-unallocated")).toContainText("Over-planned");
  await expect(page.getByTestId("metric-personal-unallocated")).toContainText("−$40");
  await expect(page.getByText("Shopping", { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("changing the income-tax estimate flows through to net take-home", async ({ page }) => {
  await signIn(page, "arielle");
  await page.goto("/settings");
  const form = page.getByTestId("owner-form-per_demo_arielle");
  await form.getByLabel("Income tax withheld per month (estimate)").fill("500");
  await form.getByRole("button", { name: /Save Arielle/ }).click();
  await expect(form.getByText("Saved.")).toBeVisible();
  await page.goto("/personal/sp_demo_arielle");
  // $3,000 − $229.50 − $500 = $2,270.50
  await expect(page.getByTestId("metric-personal-net")).toContainText("$2,271");
});

test("manual entry and CSV import land in the ledger without double counting", async ({ page }) => {
  await signIn(page, "arielle");
  await page.goto("/transactions?space=sp_demo_arielle");
  const form = page.getByTestId("transaction-form");
  await form.getByLabel("Kind").selectOption("expense");
  await form.getByLabel("Amount").fill("42.50");
  await form.getByLabel("Description").fill("E2E coffee beans");
  await form.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Added.")).toBeVisible();
  await expect(page.getByTestId("transactions-table")).toContainText("E2E coffee beans");

  await page.goto("/transactions/import");
  await page.getByLabel("Into account").selectOption({ label: "Arielle checking · Arielle" });
  const csv = "Date,Description,Amount\n2026-09-04,E2E imported dinner,-31.20\n2026-09-05,E2E imported refund,12.00\n";
  await page.getByLabel("CSV file").setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("csv-preview")).toContainText("E2E imported dinner");
  await page.getByTestId("csv-commit").click();
  await expect(page.getByTestId("csv-result")).toContainText("Imported 2");

  // Importing the same file again skips the duplicates.
  await page.getByLabel("CSV file").setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("csv-preview").getByText("duplicate")).toHaveCount(2);
  await expect(page.getByTestId("csv-commit")).toBeDisabled();

  await page.goto("/transactions?space=sp_demo_arielle&kind=expense");
  await expect(page.getByTestId("transactions-table")).toContainText("E2E imported dinner");
});

test("purchase scenarios report goal impact and shortfalls honestly", async ({ page }) => {
  await signIn(page, "arielle");
  await page.goto("/scenarios");
  const form = page.getByTestId("scenario-form");
  await form.getByLabel("What").fill("Laptop");
  await form.getByLabel("Space").selectOption({ label: "Arielle" });
  await form.getByLabel("Amount").fill("1800");
  await form.getByRole("button", { name: "Evaluate" }).click();
  const laptop = page.getByTestId("scenario-card").filter({ hasText: "Laptop" });
  await expect(laptop.getByTestId("scenario-verdict")).toHaveText("Affordable");
  await expect(laptop).toContainText("Friends travel");

  await form.getByLabel("What").fill("Car lease");
  await form.getByLabel("Space").selectOption({ label: "Arielle" });
  await form.getByLabel("Amount").fill("1600");
  await form.getByLabel("Kind").selectOption("recurring");
  await form.getByRole("button", { name: "Evaluate" }).click();
  const lease = page.getByTestId("scenario-card").filter({ hasText: "Car lease" });
  await expect(lease.getByTestId("scenario-verdict")).toHaveText("Creates a shortfall");
  await expectNoHorizontalOverflow(page);
});

test("assistant returns a labelled deterministic preview built from tools", async ({ page }) => {
  await signIn(page, "will");
  await page.goto("/assistant");
  await page.getByTestId("assistant-input").fill("What is still unknown?");
  await page.getByTestId("assistant-send").click();
  const reply = page.getByTestId("assistant-reply").last();
  await expect(reply).toContainText("Deterministic preview");
  await expect(reply).toContainText("Still unknown");
  await expect(reply).toContainText("business vs household split");
  await page.getByTestId("assistant-input").fill("What can the company put toward the household?");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-reply").last()).toContainText("Company");
});

test("navigation works at every viewport", async ({ page, isMobile }) => {
  await signIn(page, "will");
  for (const path of ["/", "/company", "/household", "/personal/sp_demo_will", "/accounts", "/settings", "/scenarios"]) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
  if (isMobile) {
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "More" })).toBeVisible();
    await page.getByRole("link", { name: "More" }).click();
    await expect(page.getByRole("link", { name: "Scenarios" })).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Scenarios" })).toBeVisible();
  }
});
