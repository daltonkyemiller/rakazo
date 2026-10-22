import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("chat contains long messages and the settings shortcut opens General", async ({
  page,
}, testInfo) => {
  await signup(page, `layout-${Date.now()}@rakazo.test`, "password12", "Layout Demo");
  await completeOnboarding(page);
  const content = "long-message-".repeat(100);
  await page.getByPlaceholder(/Message/).fill(content);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("message-user-bubble").filter({ hasText: content })).toBeVisible();
  const transcript = page.getByTestId("transcript");
  for (const width of [1280, 900, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(() => transcript.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  await captureScreenshot(page, testInfo, "chat-contained-long-message");
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByTestId("bots-sidebar")).toHaveCSS("position", "fixed");
  const chatWidth = (await transcript.boundingBox())!.width;
  await page.getByTestId("bot-settings-trigger").click();
  await expect(page.getByTestId("side-panel")).toBeVisible();
  await expect.poll(async () => (await transcript.boundingBox())!.width).toBe(chatWidth);
  await captureScreenshot(page, testInfo, "narrow-window-panel-overlays-chat");
  await page.getByRole("button", { name: "Close panel", exact: true }).click();

  await page.keyboard.press("Control+,");
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();
  await expect(settings.getByTestId("settings-header")).toContainText("General");
  await captureScreenshot(page, testInfo, "settings-keyboard-shortcut");
});

test("Mac glass keeps inset content and selected toolbar icons readable in both themes", async ({
  page,
}, testInfo) => {
  await signup(page, `glass-${Date.now()}@rakazo.test`, "password12", "Glass Demo");
  await completeOnboarding(page);
  await page.setViewportSize({ width: 1280, height: 850 });
  // A browser cannot render the native backdrop; exercise the host-enabled surface styles.
  await page.evaluate(() => {
    document.documentElement.dataset.platform = "darwin";
    document.documentElement.setAttribute("data-native-glass", "");
  });
  const history = Array.from(
    { length: 40 },
    (_, index) =>
      `Scroll test paragraph ${index + 1}. Keep this conversation readable while scrolling.`,
  ).join("\n\n");
  await page.getByPlaceholder(/Message/).fill(history);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("message-user-bubble").filter({ hasText: history })).toBeVisible();
  const transcript = page.getByTestId("transcript");
  const jump = page.getByRole("button", { name: "Jump to latest" });
  const activity = page.getByRole("button", { name: "Activity", exact: true });
  const main = page.locator('main[data-space-switch="main"]');
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await transcript.hover();
    await page.mouse.wheel(0, -5000);
    await expect(jump).toBeVisible();
    await expect(jump).toHaveCSS("backdrop-filter", "none");
    const filteredElements = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .filter((element) => getComputedStyle(element).backdropFilter !== "none")
        .map((element) => element.getAttribute("data-testid") ?? element.tagName),
    );
    expect(filteredElements).toEqual([]);
    await captureScreenshot(page, testInfo, `mac-glass-scrolled-${theme}`);
    await jump.click();
    await expect(jump).toBeHidden();
    await activity.click();
    await expect(activity).toHaveAttribute("aria-pressed", "true");
    const colors = await activity.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--sidebar-accent-foreground)";
      element.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element.querySelector("svg")!).color, expected };
    });
    expect(colors.actual).toBe(colors.expected);
    await expect(main).toHaveCSS("backdrop-filter", "none");
    await expect(page.getByTestId("shell-root")).toHaveCSS("backdrop-filter", "none");
    await expect(main).toHaveCSS("border-radius", "12px");
    await expect(main).toHaveCSS("border-left-width", "0px");
    await expect(page.getByTestId("bots-sidebar")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(
      page.locator('[data-testid="bots-sidebar"] > [data-slot="sidebar-inner"]'),
    ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const bounds = (await main.boundingBox())!;
    expect(bounds.y).toBe(8);
    expect(bounds.y + bounds.height).toBe(842);
    await captureScreenshot(page, testInfo, `mac-glass-${theme}`);
    await activity.click();
    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("user-settings")).toBeVisible();
    const overlay = page.locator('[data-slot="dialog-overlay"]');
    await expect(overlay).toHaveCSS("backdrop-filter", "none");
    const overlayColors = await overlay.evaluate((element) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--overlay)";
      element.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual: getComputedStyle(element).backgroundColor, expected };
    });
    expect(overlayColors.actual).toBe(overlayColors.expected);
    await captureScreenshot(page, testInfo, `mac-glass-settings-${theme}`);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-settings")).toBeHidden();
  }
});
