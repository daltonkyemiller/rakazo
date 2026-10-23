import { expect, type Page, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  createNamedBot,
  openNewGroup,
  rpc,
  signup,
} from "./helpers";

async function createBot(page: Page, name: string) {
  return createNamedBot(page, name);
}

test("mention picker completes with Enter and Tab", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `mention-keys-${stamp}@rakazo.test`, "password12", "Mention Keys");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  const researcherId = await createBot(page, "Researcher");
  const writerId = await createBot(page, "Research Writer");
  expect(researcherId).toBeTruthy();
  expect(writerId).toBeTruthy();

  await openNewGroup(page);
  await page.locator("label:has-text('Name') input").fill("Mention keys team");
  const panel = page.getByTestId("side-panel");
  await panel.getByRole("checkbox", { name: "Add Researcher to the group" }).click();
  await panel.getByRole("checkbox", { name: "Add Research Writer to the group" }).click();
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await page.waitForURL(/\/app\/g\/[^/]+$/);

  const composer = page.getByRole("combobox", { name: "Message Mention keys team" });
  await expect(composer).toBeVisible();

  await composer.fill("@Res");
  const picker = page.getByTestId("mention-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await expect(composer).toHaveAttribute("aria-expanded", "true");
  await captureScreenshot(page, testInfo, "mention-picker-keyboard-open");

  const researcherOption = picker.getByRole("option", { name: "@Researcher", exact: true });
  const writerOption = picker.getByRole("option", { name: "@Research Writer", exact: true });
  const inactiveBackground = await writerOption.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await researcherOption.hover();
  await composer.press("ArrowDown");
  await expect(researcherOption).toHaveAttribute("aria-selected", "false");
  await expect(researcherOption).toHaveCSS("background-color", inactiveBackground);
  await expect(picker.getByRole("option", { name: "@Research Writer" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await captureScreenshot(page, testInfo, "mention-picker-keyboard-with-parked-pointer");
  await writerOption.hover();
  await researcherOption.hover();
  await expect(researcherOption).toHaveAttribute("aria-selected", "true");
  await expect(writerOption).toHaveAttribute("aria-selected", "false");
  await writerOption.hover();
  await expect(writerOption).toHaveAttribute("aria-selected", "true");
  await composer.press("Enter");
  await expect(page.getByTestId("mention-picker")).toHaveCount(0);
  await expect(
    page.getByTestId("mention-chip").filter({ hasText: "Research Writer" }),
  ).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveAttribute("aria-expanded", "false");
  await captureScreenshot(page, testInfo, "mention-picker-keyboard-completed");

  await page.getByRole("button", { name: "Remove mention Research Writer" }).click();
  await composer.fill("@Res");
  await expect(page.getByTestId("mention-picker")).toBeVisible();
  await composer.press("Tab");
  await expect(page.getByTestId("mention-picker")).toHaveCount(0);
  await expect(page.getByTestId("mention-chip").filter({ hasText: "Researcher" })).toBeVisible();
  await expect(composer).toBeFocused();

  await page.getByRole("button", { name: "Remove mention Researcher" }).click();
  await composer.fill("@Res");
  await expect(page.getByTestId("mention-picker")).toBeVisible();
  await composer.press("Escape");
  await expect(page.getByTestId("mention-picker")).toHaveCount(0);
  await expect(composer).toHaveValue("@Res");
  await expect(page.getByTestId("mention-chip")).toHaveCount(0);
  await expect(composer).toBeFocused();

  await composer.fill("hello without a picker");
  await composer.press("Enter");
  await expect(page.getByTestId("transcript")).toContainText("hello without a picker", {
    timeout: 60_000,
  });
});

test("registered MCP servers can be tagged without sending a connection ID", async ({
  page,
}, testInfo) => {
  await signup(page, `mcp-mention-${Date.now()}@rakazo.test`, "password12", "MCP Mentions");
  await completeOnboarding(page);
  await rpc(page, "mcp/servers/create", {
    slug: "work-notes",
    name: "Work Notes",
    transport: "streamable_http",
    endpoint: "https://notes.example.test/mcp",
    enabled: true,
  });
  await page.reload();
  const composer = page.getByRole("combobox", { name: /^Message / }).first();
  await composer.fill("@Work");
  const picker = page.getByTestId("mention-picker");
  const option = picker.getByRole("option", { name: "@Work Notes", exact: true });
  await expect(option).toBeVisible();
  await expect(option).toContainText("MCP server");
  await captureScreenshot(page, testInfo, "mention-registered-mcp-server");
  await composer.press("Enter");
  await expect(page.getByTestId("mention-chip").filter({ hasText: "Work Notes" })).toBeVisible();
  await composer.press("End");
  await composer.press(" ");
  await page.keyboard.type("Find my draft");
  const request = page.waitForRequest(
    (request) => request.url().endsWith("/rpc/threads/send") && request.method() === "POST",
  );
  await composer.press("Enter");
  const sent = (await request).postDataJSON().json;
  expect(sent.text).toContain("Use these connectors if relevant: Work Notes.");
  expect(sent.mentions ?? []).toEqual([]);
});
