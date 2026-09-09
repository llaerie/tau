import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page, persona: "alex" | "sam") {
  await page.goto("/sign-in");
  await page.getByTestId(`persona-${persona}`).click();
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByTestId("mode-badge").first()).toHaveText("Synthetic demo data");
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
