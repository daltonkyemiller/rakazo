import { expect, test } from "@playwright/test";
import {
  captureScreenshot,
  completeOnboarding,
  expandAdvancedSection,
  rpc,
  signup,
} from "./helpers";

test("shows directly registered MCP servers in Integrations without catalog connections", async ({
  page,
}, testInfo) => {
  await signup(page, `direct-mcp-list-${Date.now()}@rakazo.test`, "password12", "Direct MCP List");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  await expandAdvancedSection(page.getByTestId("integrations-advanced"));
  await page.getByRole("button", { name: "Manage MCP servers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "MCP servers", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Add server", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add MCP server", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "URL, command, or config" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "MCP servers", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close integrations", exact: true }).click();
  for (const name of ["Dropbox", "GitHub"])
    await rpc(page, "mcp/servers/create", {
      slug: name.toLowerCase(),
      name,
      transport: "streamable_http",
      endpoint: `https://${name.toLowerCase()}.example.test/mcp`,
      secret: "fake-mcp-credential",
    });
  expect(await rpc(page, "connections/list", undefined)).toEqual([]);
  await page.getByRole("button", { name: "Connect apps", exact: true }).click();
  const servers = page.getByTestId("registered-mcp-servers");
  await expect(servers.getByText("Dropbox", { exact: true })).toBeVisible();
  await expect(servers.getByText("GitHub", { exact: true })).toBeVisible();
  await expect(servers.getByTestId("registered-mcp-server")).toHaveCount(2);
  for (const name of ["Dropbox", "GitHub"]) {
    const server = servers.getByTestId("registered-mcp-server").filter({
      has: page.getByText(name, { exact: true }),
    });
    // Each row says where the server runs and opens its detail; no inline controls.
    await expect(server).toContainText(`${name.toLowerCase()}.example.test`);
    await expect(server.getByText(name.charAt(0), { exact: true })).toBeVisible();
    await expect(server.getByRole("button")).toHaveCount(0);
  }
  await expect(servers).not.toContainText("fake-mcp-credential");
  await captureScreenshot(page, testInfo, "integrations-direct-mcp-servers");
  await page.getByRole("textbox", { name: "Search apps", exact: true }).fill("github");
  await expect(servers.getByTestId("registered-mcp-server")).toHaveCount(1);
  await expect(servers.getByText("GitHub", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await captureScreenshot(page, testInfo, "integrations-direct-mcp-mobile");
  await expandAdvancedSection(page.getByTestId("integrations-advanced"));
  await expect(page.getByRole("button", { name: "Manage MCP servers", exact: true })).toHaveCount(
    1,
  );
  await servers.getByRole("button", { name: "Manage MCP servers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "MCP servers", exact: true })).toBeVisible();
  await expect(page.getByTestId("mcp-server-row").filter({ hasText: "GitHub" })).toBeVisible();
  await page.getByTestId("mcp-server-row").filter({ hasText: "GitHub" }).click();
  const detail = page.getByTestId("mcp-server-detail");
  await expect(detail.getByRole("heading", { name: "GitHub" })).toBeVisible();
  await expect(detail.getByText("Runs on github.example.test", { exact: true })).toBeVisible();
  await expect(detail.getByText("Credential saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to MCP servers", exact: true }).click();
  await expect(page.getByTestId("mcp-server-row").filter({ hasText: "GitHub" })).toBeFocused();
});
