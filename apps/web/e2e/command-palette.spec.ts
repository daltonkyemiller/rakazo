import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("command palette opens with keyboard, filters, and switches bots", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `cmdk-bots-${stamp}@rakazo.test`, "password12", "CmdK Bots");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const chiefId = activeBotId(page);
  const researcher = await rpc<{ id: string }>(page, "bots/create", {
    name: "Researcher",
    title: "research lead",
    description: "Finds sources and writes briefs.",
    instructions: "",
    notifyOnFinish: true,
    computerMode: "team",
  });
  await page.reload();
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect(
    page
      .locator("aside")
      .first()
      .getByRole("button", { name: /^Researcher/ }),
  ).toBeVisible();

  await page.keyboard.press("ControlOrMeta+K");
  const palette = page.getByTestId("command-palette");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await expect(palette).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Chief/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Researcher/ })).toBeVisible();
  await captureScreenshot(page, testInfo, "command-palette-bots");

  const search = page.getByTestId("command-palette-search");
  await expect(search).toBeFocused();
  const rows = palette.getByRole("option");
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(rows.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(rows.first()).toHaveAttribute("aria-selected", "false");
    const menuBackground = await palette.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const selectedBackground = await rows
      .nth(1)
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(selectedBackground).not.toBe(menuBackground);
    expect(selectedBackground).not.toBe("rgba(0, 0, 0, 0)");
    await captureScreenshot(page, testInfo, `command-palette-keyboard-${theme}`);
    await page.keyboard.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  }
  await search.fill("Research");
  // Chat matches may also appear, so check the bot rows by id.
  await expect(page.getByTestId(`command-palette-bot-${researcher.id}`)).toBeVisible();
  await expect(page.getByTestId(`command-palette-bot-${chiefId}`)).toHaveCount(0);
  await captureScreenshot(page, testInfo, "command-palette-filtered");

  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await page.waitForURL(new RegExp(`/app/${researcher.id}$`));
  expect(activeBotId(page)).toBe(researcher.id);
  await expect(page.getByRole("combobox", { name: "Message Researcher" })).toBeVisible();

  await page.getByTestId("sidebar-search-trigger").click();
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await page.getByTestId(`command-palette-bot-${chiefId}`).click();
  await page.waitForURL(new RegExp(`/app/${chiefId}$`));
  expect(activeBotId(page)).toBe(chiefId);
});

test("desktop toolbar has three controls and search opens matching chat history", async ({
  page,
}, testInfo) => {
  await signup(page, `desktop-search-${Date.now()}@rakazo.test`, "password12", "Search Demo");
  await completeOnboarding(page);
  const search = page.getByTestId("sidebar-search-trigger");
  const toolbar = search.locator("..");
  await expect(toolbar.locator(":scope > button")).toHaveCount(3);
  const footer = page.getByTestId("sidebar-footer");
  await expect(footer.getByRole("button", { name: "Connect apps", exact: true })).toBeVisible();
  await expect(footer.getByTestId("user-menu-trigger")).toContainText("Search Demo");
  await expect(page.getByTestId("sidebar-search")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "desktop-three-control-toolbar");

  const phrase = "Remember the amberlighthouse marker for our test.";
  await page.getByPlaceholder(/Message/).fill(phrase);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("message-user-bubble").filter({ hasText: phrase })).toBeVisible();
  await search.click();
  await page.getByTestId("command-palette-search").fill("amberlighthouse");
  const chats = page.getByTestId("command-palette-chats");
  await expect(chats).toContainText("amberlighthouse");
  await captureScreenshot(page, testInfo, "desktop-chat-history-search");
  await chats.getByRole("option").first().click();
  await expect(page.getByRole("dialog", { name: "Search", exact: true })).toBeHidden();
  await expect(page.getByTestId("message-user-bubble").filter({ hasText: phrase })).toBeVisible();
});
