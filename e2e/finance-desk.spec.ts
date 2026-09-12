import { expect, test } from "@playwright/test";
import { ask, expectNoHorizontalOverflow, resetDemo, signIn, signOut } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, "will");
  await resetDemo(page);
  await page.close();
});

test("A. Arielle opens the app: assistant first, briefing, composer, three starters", async ({ page, isMobile }) => {
  await signIn(page, "arielle");
  // Arielle's plan is incomplete, so the briefing leads with setup and names one next step.
  await expect(page.getByTestId("briefing")).toContainText("Let’s finish your money plan.");
  await expect(page.getByTestId("briefing")).toContainText(/Good (morning|afternoon|evening), Arielle/);
  await expect(page.getByTestId("next-step")).toContainText("Set your food target");
  // The one money summary lives in the context rail: a floor, with its caveat attached.
  const rail = page.getByTestId(isMobile ? "context-inline" : "context-rail");
  await expect(rail).toContainText("Take-home so far");
  await expect(rail).toContainText("$2,732");
  await expect(rail).toContainText("Before income tax.");
  await expect(page.getByTestId("starter-what-can-i-spend-")).toBeVisible();
  await expect(page.getByTestId("starter-record-a-receipt")).toBeVisible();
  await expect(page.getByTestId("starter-plan-a-purchase")).toBeVisible();
  await expect(page.getByLabel("Ask about your money")).toBeVisible();
  await expect(page.getByTestId("assistant-status")).toContainText("Preview mode");
  await expect(page.getByTestId("connect-assistant")).toBeVisible();
  if (isMobile) {
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link")).toHaveCount(4);
    await page.getByTestId("profile-menu").click();
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await expectNoHorizontalOverflow(page);
});

test("B. food question separates gross, take-home status, target and missing inputs; never invents a target", async ({ page }) => {
  await signIn(page, "arielle");
  const turn = await ask(page, "How much can I spend on food?");
  await expect(turn.getByTestId("assistant-text")).toContainText("no food target yet");
  await expect(turn.getByTestId("assistant-text")).toContainText("before income tax");
  await expect(turn.getByTestId("assistant-text")).toContainText("cannot give an exact available-to-spend amount");
  await expect(turn.getByTestId("result-food_plan")).toBeVisible();
  await expect(turn.getByTestId("result-food_plan")).toContainText("Gross salary");
  await expect(turn.getByTestId("result-food_plan")).toContainText("$3,000");
  await expect(turn.getByTestId("next-action")).toHaveText("Set a food target");
  await expect(turn.getByText("Preview answer.", { exact: false })).toBeVisible();
});

test("C/J. 'Set my food budget to $1,200' previews old/new, needs approval, persists once even when repeated", async ({ page }) => {
  await signIn(page, "arielle");
  const turn = await ask(page, "Set my food budget to $1,200");
  const card = turn.getByTestId("action-budget_change");
  await expect(card).toContainText("Waiting for you");
  await expect(card).toContainText("$1,200");
  await expect(card).toContainText(/Left after plan|unallocated/i);
  await card.getByTestId("action-approve").click();
  await expect(card).toContainText("Applied");
  const again = await ask(page, "Set my food budget to $1,200");
  const card2 = again.getByTestId("action-budget_change");
  await expect(card2).toContainText("$1,200");
  await card2.getByTestId("action-approve").click();
  await expect(card2).toContainText("Applied");
  await page.goto("/money?space=me");
  await expect(page.getByTestId("food-plan")).toContainText("$1,200");
  await expect(page.getByTestId("food-plan")).toContainText("left");
  // Setting the target does not invent an unallocated figure: withholding is still unconfirmed.
  await expect(page.getByTestId("plan-panel")).toContainText("Not yet known");
  await expect(page.getByTestId("plan-panel")).toContainText("Confirm withholding");
});

test("K. a detailed number opens its calculation in one click", async ({ page }) => {
  await signIn(page, "arielle");
  await page.goto("/money?space=me");
  // The principal figure opens its evidence in one click.
  await page.getByTestId("calc-unallocated-monthly-plan").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Where this comes from");
  await expect(dialog).toContainText("Formula");
  await expect(dialog).toContainText("Inputs");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  // Take-home keeps its own breakdown, one disclosure away.
  await page.getByTestId("take-home").locator("summary").click();
  await expect(page.getByTestId("take-home")).toContainText("Employee FICA");
  await expect(page.getByTestId("take-home")).toContainText("Income tax withheld");
});

test("D. a $120 dinner receipt split equally records one expense with two $60 shares", async ({ page }) => {
  await signIn(page, "arielle");
  await page.goto("/documents");
  await page.getByTestId("upload-file").setInputFiles({ name: "dinner.txt", mimeType: "text/plain", buffer: Buffer.from("Nopa\nTable 4\nTotal $120.00\n2026-09-09\n") });
  await page.getByTestId("upload-space").selectOption({ label: "Arielle (private)" });
  await page.getByTestId("upload-submit").click();
  await expect(page.getByText("Stored dinner.txt.")).toBeVisible();
  await page.getByTestId("document-list").getByText("dinner.txt").click();
  const drawer = page.getByTestId("document-detail");
  await expect(drawer).toContainText("$120.00");
  await expect(drawer.getByTestId("expense-amount")).toHaveValue("120.00");
  await drawer.getByTestId("expense-split").check();
  await drawer.getByTestId("expense-preview").click();
  const card = drawer.getByTestId("action-expense");
  await expect(card).toContainText("Arielle's share");
  await expect(card.getByText("$60.00")).toHaveCount(2);
  await card.getByTestId("action-approve").click();
  // Once applied, the page refreshes and the receipt shows as recorded.
  await expect(drawer).toContainText(/Recorded as an expense|Applied/);
  await page.goto("/activity?q=Nopa");
  await expect(page.getByTestId("activity-list").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("activity-list")).toContainText("split");
  await expect(page.getByTestId("activity-list")).toContainText("−$120");
  await page.goto("/money?space=me");
  await expect(page.getByTestId("food-plan")).toContainText("$113");
});

test("E. 'Can the company buy a $2,000 computer next month?' is conditional and offers a plan, not a payment", async ({ page }) => {
  await signIn(page, "will");
  await page.getByTestId("scope-company").click();
  const turn = await ask(page, "Can the company buy a $2,000 computer next month?");
  await expect(turn.getByTestId("assistant-text")).toContainText(/conditional|not decidable/i);
  await expect(turn.getByTestId("assistant-text")).toContainText(/Still unknown/);
  await expect(turn.getByTestId("result-purchase_scenario")).toBeVisible();
  await expect(turn.getByTestId("assistant-text")).toContainText("nothing would be paid");
});

test("F. 'Add a $3,000 sofa paid by the company' records payer company, beneficiary household, treatment review", async ({ page }) => {
  await signIn(page, "will");
  await page.getByTestId("scope-company").click();
  const turn = await ask(page, "Add a $3,000 sofa paid by the company");
  const card = turn.getByTestId("action-purchase_plan");
  await expect(card).toContainText("Our company / household");
  await expect(card).toContainText("review required");
  await expect(card).toContainText("not deductible");
  await expect(card).toContainText("No purchase, payment or subscription is executed");
  await card.getByTestId("action-approve").click();
  await expect(card).toContainText("Applied");
  await page.goto("/money?space=company");
  await expect(page.getByTestId("purchase-plans")).toContainText("sofa");
  await expect(page.getByTestId("purchase-plans")).toContainText("$3,000");
  await expect(page.getByTestId("activity-list")).toHaveCount(0);
});

test("G. AI tools: two seats per provider, tiers unconfirmed, API usage separate, no $400 total", async ({ page }) => {
  await signIn(page, "will");
  const turn = await ask(page, "What are all our AI tools costing?");
  const text = turn.getByTestId("assistant-text");
  await expect(text).toContainText("Anthropic Claude × 2");
  await expect(text).toContainText("OpenAI ChatGPT × 2");
  await expect(text).toContainText("price unconfirmed");
  await expect(text).toContainText("API usage last month");
  await expect(text).not.toContainText("$400");
});

test("H. Will asking for Arielle's purchases gets only the shared summary; her rows never reach him", async ({ page }) => {
  await signIn(page, "will");
  const turn = await ask(page, "What did Arielle buy this month?");
  await expect(turn.getByTestId("assistant-text")).toContainText("Individual purchases are private");
  await expect(turn.getByTestId("assistant-text")).not.toContainText("Nopa");
  await page.goto("/money?space=partner");
  await expect(page.getByTestId("partner-summary")).toContainText("Food this month");
  await expect(page.getByTestId("partner-summary")).not.toContainText("Nopa");
  const exp = await page.request.get("/api/export");
  expect(exp.status()).toBe(200);
  expect(await exp.text()).not.toContain("sp_demo_arielle");
  const docs = await page.request.get("/api/documents");
  expect((await docs.json()).documents.some((d: { filename: string }) => d.filename === "dinner.txt")).toBe(false);
  await page.goto("/activity?q=Nopa");
  await expect(page.getByText("No entries match")).toBeVisible();
});

test("I. a delayed company payment: expected receipts stay expected, not deposited", async ({ page }) => {
  await signIn(page, "will");
  await page.getByTestId("scope-company").click();
  const turn = await ask(page, "The company payment is delayed this month");
  const text = turn.getByTestId("assistant-text");
  await expect(text).toContainText("Expected receipts $30,000");
  await expect(text).toContainText("received this month $0");
  await expect(text).toContainText("not safe to spend");
  await expect(turn.getByTestId("result-obligations")).toBeVisible();
});

test("J. voice: push-to-talk is offered where supported and the transcript is reviewed before sending", async ({ page }) => {
  await signIn(page, "arielle");
  const supported = await page.evaluate(() => "webkitSpeechRecognition" in window || "SpeechRecognition" in window);
  if (supported) {
    await expect(page.getByTestId("push-to-talk")).toBeVisible();
    await expect(page.getByTestId("push-to-talk")).toHaveAttribute("aria-pressed", "false");
  } else {
    await expect(page.getByText("Voice unavailable here")).toBeVisible();
  }
  await expect(page.getByLabel("Ask about your money")).toHaveValue("");
});

test("themes persist per user and old routes redirect into the five destinations", async ({ page }) => {
  await signIn(page, "arielle");
  await page.goto("/settings");
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByTestId("theme-system").click();
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  for (const [from, to] of [["/company", "/money?space=company"], ["/household", "/money?space=household"], ["/personal/sp_demo_arielle", "/money?space=me"], ["/transactions", "/activity"], ["/assistant", "/"], ["/scenarios", "/"], ["/more", "/settings"], ["/onboarding", "/"]]) {
    await page.goto(from);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(to);
  }
  await signOut(page);
});

test("privacy on the wire: the partner's documents 404 and their personal space is not a tab", async ({ page }) => {
  await signIn(page, "arielle");
  const mine = await page.request.get("/api/documents");
  const doc = (await mine.json()).documents.find((d: { filename: string }) => d.filename === "dinner.txt");
  expect(doc).toBeTruthy();
  await signOut(page);
  await signIn(page, "will");
  const res = await page.request.get(`/api/documents/${doc.id}`);
  expect(res.status()).toBe(404);
  await page.goto("/money");
  await expect(page.getByTestId("tab-partner")).toHaveText("Arielle's summary");
  await expect(page.getByTestId("tab-me")).toHaveText("My money");
});
