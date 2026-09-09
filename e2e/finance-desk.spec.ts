import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, resetDemo, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, "alex");
  await resetDemo(page);
  await page.close();
});

test("overview keeps spaces separate and marks unknowns honestly", async ({ page }) => {
  await signIn(page, "alex");
  await expect(page.getByRole("heading", { name: /Good to see you, Alex/ })).toBeVisible();
  await expect(page.getByTestId("cash-company")).toContainText("known so far");
  await expect(page.getByTestId("cash-household")).toContainText("$3,722");
  await expect(page.getByTestId("cash-personal")).toContainText("$9,332");
  await expect(page.getByText("Anticipated monthly revenue", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Company revenue, not take-home")).toBeVisible();
  await expect(page.getByText("The household plan is short by $975 a month")).toBeVisible();
  await expect(page.getByText(/Alex's payroll withholding estimate/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("company page explains provenance and keeps unknown costs unknown", async ({ page }) => {
  await signIn(page, "alex");
  await page.goto("/company");
  const distributable = page.getByTestId("metric-company-distributable");
  await expect(distributable).toContainText("$14,350");
  await expect(distributable).toContainText("3 unknown");
  await distributable.getByRole("button", { name: "Where this comes from" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("revenue − committed");
  await expect(dialog).toContainText("Upper bound only");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Employer payroll cost rate not set", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("personal spaces are private: Alex cannot open Sam's space, Sam can", async ({ page }) => {
  await signIn(page, "alex");
  const res = await page.goto("/personal/sp_demo_sam");
  expect(res?.status()).toBe(404);
  await page.goto("/more");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/sign-in/);
  await signIn(page, "sam");
  await page.goto("/personal/sp_demo_sam");
  await expect(page.getByRole("heading", { name: "Sam" })).toBeVisible();
  const alexRes = await page.goto("/personal/sp_demo_alex");
  expect(alexRes?.status()).toBe(404);
});

test("entering a withholding estimate funds the travel goal before discretionary spending", async ({ page }) => {
  await signIn(page, "alex");
  await page.goto("/personal/sp_demo_alex");
  await expect(page.getByTestId("metric-personal-net")).toContainText("1 unknown");
  await page.getByPlaceholder(/e\.g\. 23/).fill("25");
  await page.getByRole("button", { name: "Save estimate" }).click();
  // Once net is known the "unknown" card (and its form) disappears and the metrics update in place.
  await expect(page.getByTestId("metric-personal-net")).toContainText("$2,250");
  await expect(page.getByTestId("metric-personal-net")).not.toContainText("unknown");
  await expect(page.getByTestId("metric-personal-available")).toContainText("$145");
  const goalsRow = page.getByRole("row", { name: /^1 Friends travel/ });
  await expect(goalsRow).toContainText("Fully funded");
  await expectNoHorizontalOverflow(page);
});

test("manual entry and CSV import land in the ledger without double counting", async ({ page }) => {
  await signIn(page, "alex");
  await page.goto("/transactions?space=sp_demo_alex");
  const form = page.getByTestId("transaction-form");
  await form.getByLabel("Kind").selectOption("expense");
  await form.getByLabel("Amount").fill("42.50");
  await form.getByLabel("Description").fill("E2E coffee beans");
  await form.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Added.")).toBeVisible();
  await expect(page.getByTestId("transactions-table")).toContainText("E2E coffee beans");

  await page.goto("/transactions/import");
  await page.getByLabel("Into account").selectOption({ label: "Alex checking · Alex" });
  await page.getByLabel("CSV file").setInputFiles({
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Amount\n2026-09-04,E2E imported dinner,-31.20\n2026-09-05,E2E imported refund,12.00\n"),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("csv-preview")).toContainText("E2E imported dinner");
  await page.getByTestId("csv-commit").click();
  await expect(page.getByTestId("csv-result")).toContainText("Imported 2");

  // Importing the same file again skips the duplicates.
  await page.getByLabel("CSV file").setInputFiles({
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Amount\n2026-09-04,E2E imported dinner,-31.20\n2026-09-05,E2E imported refund,12.00\n"),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("csv-preview").getByText("duplicate")).toHaveCount(2);
  await expect(page.getByTestId("csv-commit")).toBeDisabled();

  await page.goto("/transactions?space=sp_demo_alex&kind=expense");
  await expect(page.getByTestId("transactions-table")).toContainText("E2E imported dinner");
});

test("purchase scenarios report goal impact and shortfalls honestly", async ({ page }) => {
  await signIn(page, "alex");
  await page.goto("/scenarios");
  const form = page.getByTestId("scenario-form");
  await form.getByLabel("What").fill("Laptop");
  await form.getByLabel("Space").selectOption({ label: "Alex" });
  await form.getByLabel("Amount").fill("1800");
  await form.getByRole("button", { name: "Evaluate" }).click();
  await expect(page.getByTestId("scenario-card").first()).toContainText("Laptop");
  await expect(page.getByTestId("scenario-verdict").first()).toHaveText("Affordable");

  await form.getByLabel("What").fill("Car lease");
  await form.getByLabel("Space").selectOption({ label: "Alex" });
  await form.getByLabel("Amount").fill("600");
  await form.getByLabel("Kind").selectOption("recurring");
  await form.getByRole("button", { name: "Evaluate" }).click();
  const card = page.getByTestId("scenario-card").filter({ hasText: "Car lease" });
  await expect(card.getByTestId("scenario-verdict")).toHaveText("Creates a shortfall");
  await expect(card).toContainText("Friends travel");
  await expectNoHorizontalOverflow(page);
});

test("assistant returns a labelled deterministic preview built from tools", async ({ page }) => {
  await signIn(page, "alex");
  await page.goto("/assistant");
  await page.getByTestId("assistant-input").fill("What is still unknown?");
  await page.getByTestId("assistant-send").click();
  const reply = page.getByTestId("assistant-reply").last();
  await expect(reply).toContainText("Deterministic preview");
  await expect(reply).toContainText("Still unknown");
  await expect(reply).toContainText("Employee allocation payroll classification");
  await page.getByTestId("assistant-input").fill("Can I afford a $1,800 laptop this month?");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-reply").last()).toContainText("Purchase scenario");
});

test("navigation works at every viewport", async ({ page, isMobile }) => {
  await signIn(page, "alex");
  for (const path of ["/", "/company", "/household", "/personal/sp_demo_alex", "/accounts", "/settings"]) {
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
