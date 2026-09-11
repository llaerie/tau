import { expect, type Page } from "@playwright/test";

export type Persona = "will" | "arielle";

export async function signIn(page: Page, persona: Persona) {
  await page.goto("/sign-in");
  await page.getByTestId(`persona-${persona}`).click();
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByTestId("mode-badge").first()).toHaveText("Synthetic demo data");
}

export async function signOut(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/sign-in/);
}

export async function resetDemo(page: Page) {
  await page.goto("/settings");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("reset-demo").click();
  await expect(page.getByText("Demo data reset.")).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow, "page should not scroll horizontally").toBe(false);
}

/** Send a message through the composer and wait for the assistant turn to settle. */
export async function ask(page: Page, message: string) {
  const before = await page.getByTestId("turn-assistant").count();
  await page.getByLabel("Ask about your money").fill(message);
  await page.getByTestId("composer-send").click();
  await expect(page.getByTestId("turn-assistant")).toHaveCount(before + 1);
  const turn = page.getByTestId("turn-assistant").nth(before);
  await expect(turn.getByText("Working…")).toHaveCount(0);
  await expect(page.getByTestId("composer-send")).toBeVisible();
  return turn;
}
