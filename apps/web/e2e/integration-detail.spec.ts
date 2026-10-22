import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

const gmailLogo = "https://logos.composio.dev/api/gmail";
// Enough connected apps that the list scrolls, with Gmail last so opening it needs a scroll.
const fillers = Array.from({ length: 24 }, (_, index) => `app${String(index).padStart(2, "0")}`);
const catalog = [
  ...fillers.map((slug) => ({
    connectorId: "composio",
    slug,
    name: `App ${slug.slice(3)}`,
    connected: true,
    noAuth: false,
    logo: null,
  })),
  {
    connectorId: "composio",
    slug: "gmail",
    name: "Gmail",
    connected: true,
    noAuth: false,
    logo: gmailLogo,
  },
];
const connection = (id: string, provider: string, displayName: string) => ({
  id,
  connectorId: "composio",
  provider,
  displayName,
  status: "connected",
  capabilities: [],
  createdAt: "2026-01-01T00:00:00.000Z",
});
const connections = [
  ...fillers.map((slug) => connection(`conn-${slug}`, slug, `App ${slug.slice(3)}`)),
  connection("conn-gmail", "gmail", "Gmail"),
  connection("conn-gmail-work", "gmail", "Work"),
  connection("conn-gmail-slack", "gmail", "visor-slack"),
];

test("connected integration detail stays in one dialog and mentions show app logos", async ({
  page,
}, testInfo) => {
  await page.route(gmailLogo, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: readFileSync(new URL("./fixtures/app-marks/gmail.svg", import.meta.url)),
    }),
  );
  await page.route("**/rpc/connections/catalog", (route) =>
    route.fulfill({ json: { json: catalog } }),
  );
  await page.route("**/rpc/connections/list", (route) =>
    route.fulfill({ json: { json: connections } }),
  );
  await page.route("**/rpc/connections/tools", (route) =>
    route.fulfill({
      json: { json: [{ name: "GMAIL_SEND_EMAIL", description: "Send an email" }] },
    }),
  );

  await signup(page, `integration-detail-${Date.now()}@rakazo.test`, "password12", "Detail User");
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Connect apps", exact: true }).first().click();
  await page.getByRole("button", { name: "Connected integrations", exact: true }).click();
  const list = page.locator("#integration-list");
  const gmailTile = page.getByTestId("connection-tile-gmail").getByRole("button");
  await gmailTile.scrollIntoViewIfNeeded();
  const scrollTop = await list.evaluate((element) => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);

  await gmailTile.click();
  const detail = page.getByTestId("connection-detail");
  await expect(detail).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("Gmail");
  await expect(detail.getByLabel("Account label")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Back to connected integrations", exact: true }),
  ).toBeFocused();
  await captureScreenshot(page, testInfo, "integration-detail");

  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(list).toBeVisible();
  expect(await list.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await expect(gmailTile).toBeFocused();

  await page.getByPlaceholder("Search apps").fill("work");
  await expect(page.getByTestId("connection-tile-gmail")).toContainText("Work");
  await gmailTile.click();
  await expect(detail).toBeVisible();
  await page.getByRole("button", { name: "Back to connected integrations", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(page.getByPlaceholder("Search apps")).toHaveValue("work");
  await captureScreenshot(page, testInfo, "integration-detail-back-filtered");

  await page.getByRole("button", { name: "Close integrations", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await rpc(page, "bots/create", {
    name: "Slackbot",
    title: "",
    description: "",
    notifyOnFinish: true,
    computerMode: "team",
  });
  await page.reload();
  const composer = page.getByRole("combobox", { name: /Message/ });
  await composer.fill("@");
  const picker = page.getByTestId("mention-picker");
  for (const name of ["Gmail", "Work", "visor-slack"]) {
    await composer.fill(`@${name}`);
    const logo = picker.getByRole("option", { name: `@${name}`, exact: true }).locator("img");
    await expect(logo).toHaveAttribute("src", gmailLogo);
    await expect
      .poll(() => logo.evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await captureScreenshot(page, testInfo, "mention-integration-profile-logos");

  await composer.fill("@slack");
  await expect(picker.getByRole("option").first()).toHaveAccessibleName("@visor-slack");
  await expect(picker.getByRole("option", { name: "@Slackbot", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "mention-profile-word-match");

  await composer.fill("@Work");
  await picker.getByRole("option", { name: "@Work", exact: true }).click();
  const chip = page.getByTestId("mention-chip").filter({ hasText: "Work" });
  await expect(chip.locator("img")).toHaveAttribute("src", gmailLogo);
});
