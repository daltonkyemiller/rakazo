import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("computer resources are searchable, configurable, and readable in both themes", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    let state = {
      capacity: { memoryGiB: 16, cpuCores: 12 },
      defaults: { memoryGiB: 2, cpuCores: 2 },
      computers: [
        {
          id: "test-computer",
          shared: true,
          running: true,
          limits: { memoryGiB: 2, cpuCores: 2 },
          usage: { memoryGiB: 1.2, cpuCores: 0.5 },
          memoryKilled: true,
        },
      ],
    };
    Object.defineProperty(window, "rakazoDesktop", {
      value: {
        platform: "darwin",
        window: {
          close: async () => {},
          minimize: async () => {},
          toggleMaximize: async () => {},
          state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
        },
        oauth: { onCallback: () => () => {} },
        resources: {
          state: async () => state,
          apply: async (settings: {
            memoryGiB: number;
            cpuCores: number;
            applyToExisting: boolean;
          }) => {
            state = {
              ...state,
              defaults: { memoryGiB: settings.memoryGiB, cpuCores: settings.cpuCores },
              computers: state.computers.map((computer) =>
                settings.applyToExisting
                  ? {
                      ...computer,
                      limits: { memoryGiB: settings.memoryGiB, cpuCores: settings.cpuCores },
                    }
                  : computer,
              ),
            };
            return state;
          },
        },
      },
    });
  });
  await signup(page, `resources-${Date.now()}@rakazo.test`, "password12", "Resources Demo");
  await completeOnboarding(page);
  const settings = await openUserSettings(page);
  const search = settings.getByRole("combobox", { name: "Search settings" });
  await search.fill("ram");
  await settings.getByRole("option", { name: "Resource limits Computer" }).click();
  const resources = settings.getByTestId("computer-resources-settings");
  await expect(resources).toBeVisible();
  await expect(resources.getByText("16 GB / 12 cores")).toBeVisible();
  await expect(resources.getByText("Memory limit was reached.")).toBeVisible();
  await resources.getByRole("combobox", { name: "Computer resource preset" }).click();
  await page.getByRole("option", { name: "4 GB / 4 cores", exact: true }).click();
  await resources.getByRole("button", { name: "Apply limits" }).click();
  await expect(resources.getByText("Resources updated")).toBeVisible();
  await expect(resources.getByText("1.2 GB / 4 GB")).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await captureScreenshot(page, testInfo, `computer-resources-${theme}`);
  }
  await resources.getByRole("combobox", { name: "Computer resource preset" }).click();
  await page.getByRole("option", { name: "Custom…", exact: true }).click();
  await resources.getByRole("spinbutton", { name: "Memory (GB)" }).fill("0");
  await resources.getByRole("button", { name: "Apply limits" }).click();
  await expect(resources.getByRole("alert")).toHaveText("Choose valid memory and CPU limits.");
});
