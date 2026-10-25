// @vitest-environment jsdom

import type { AccountSecurity } from "@rakazo/contracts";
import type * as UiWeb from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray) => strings.join(""),
    i18n: { locale: "en" },
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@rakazo/ui-web", async (importOriginal) => ({
  BotAvatar: () => null,
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  buttonVariants: (await importOriginal<typeof UiWeb>()).buttonVariants,
  Field: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  FieldLabel: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  Label: ({ children, htmlFor }: { children?: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange?: (checked: boolean) => void;
  } & React.ComponentProps<"button">) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
  Toggle: ({
    children,
    onPressedChange,
    pressed: _pressed,
    variant: _variant,
    ...props
  }: {
    children?: ReactNode;
    onPressedChange?: () => void;
    pressed?: boolean;
    variant?: string;
  } & React.ComponentProps<"button">) => (
    <button type="button" onClick={() => onPressedChange?.()} {...props}>
      {children}
    </button>
  ),
  ToggleGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ToggleGroupItem: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  OptionSelect: ({ "data-testid": testId }: { "data-testid"?: string }) => (
    <div data-testid={testId} />
  ),
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

const accountPolicy = vi.hoisted(() => ({
  passwordChangeEnabled: undefined as boolean | undefined,
}));
vi.mock("../components/AccountAccess", () => ({
  AccountAccess: ({ onSecurity }: { onSecurity: (value: AccountSecurity) => void }) => {
    useEffect(
      () =>
        onSecurity({
          hasPassword: true,
          passwordChangeEnabled: accountPolicy.passwordChangeEnabled,
          freshOidcAuth: false,
          ssoLinked: false,
          emailDeletion: false,
          sso: null,
        }),
      [onSecurity],
    );
    return null;
  },
}));

vi.mock("../components/ApprovalRulesSettings", () => ({ ApprovalRulesSettings: () => null }));
vi.mock("../components/ai/primitives", () => ({ SuccessPop: () => null }));
vi.mock("../components/ComputersUnavailableHint", () => ({
  ComputersUnavailableHint: () => null,
}));
vi.mock("../components/DesktopUpdates", () => ({ DesktopUpdateSection: () => null }));
vi.mock("../lib/auth", () => ({ authClient: { changePassword: vi.fn(), updateUser: vi.fn() } }));
vi.mock("../lib/i18n", () => ({
  getActiveUiLocale: () => "en",
  setUiLocale: (locale: string) => Promise.resolve(locale),
}));
vi.mock("../lib/ui-appearance", () => ({
  getUiAppearancePreference: () => "system",
  setUiAppearance: vi.fn(),
}));

import { authClient } from "../lib/auth";
import {
  COMPOSER_ENTER_TO_SEND_STORAGE_KEY,
  getComposerEnterToSend,
  setComposerEnterToSend,
} from "../lib/composer-enter-to-send-pref";
import { getRemoteImagesEnabled } from "../lib/remote-images-preference";
import { TOOL_ACTIVITY_STORAGE_KEY } from "../lib/tool-activity-preference";
import { GeneralSettingsPanels, UsageSettingsPanel } from "./AccountSettingsOverlay";

afterEach(() => {
  localStorage.clear();
});

it("flips the stored tool activity preference from the settings toggle", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<GeneralSettingsPanels name="Jamie" />);
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-activity-toggle"]',
    );
    if (!toggle) throw new Error("Missing tool activity toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      toggle.click();
    });

    expect(localStorage.getItem(TOOL_ACTIVITY_STORAGE_KEY)).toBe("on");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      toggle.click();
    });

    expect(localStorage.getItem(TOOL_ACTIVITY_STORAGE_KEY)).toBe("off");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("turns loading web images on and off from the settings toggle", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<GeneralSettingsPanels name="Jamie" />);
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="remote-images-toggle"]',
    );
    if (!toggle) throw new Error("Missing remote images toggle");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(getRemoteImagesEnabled()).toBe(false);

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(getRemoteImagesEnabled()).toBe(true);

    await act(async () => {
      toggle.click();
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(getRemoteImagesEnabled()).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it.each([undefined, true, false])("respects the password-change policy (%s)", async (enabled) => {
  accountPolicy.passwordChangeEnabled = enabled;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<GeneralSettingsPanels name="Test" />));
    expect(container.textContent?.includes("Change password")).toBe(enabled !== false);
  } finally {
    await act(async () => root.unmount());
    accountPolicy.passwordChangeEnabled = undefined;
    vi.unstubAllGlobals();
  }
});

it("keeps the password form closed until asked and closes it after a change", async () => {
  vi.mocked(authClient.changePassword).mockResolvedValue({ data: {}, error: null } as never);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const passwordFields = () => container.querySelectorAll('input[type="password"]');
  const setValue = (input: Element, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  try {
    await act(async () => root.render(<GeneralSettingsPanels name="Test" />));
    expect(passwordFields()).toHaveLength(0);

    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Change password",
    );
    await act(async () => open?.click());
    const [current, next, confirm] = passwordFields();
    await act(async () => {
      setValue(current!, "old-password");
      setValue(next!, "new-password-123");
      setValue(confirm!, "new-password-123");
    });
    await act(async () => container.querySelector("form")?.requestSubmit());

    expect(authClient.changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      revokeOtherSessions: true,
    });
    expect(passwordFields()).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("updates the Enter preference from Settings and reflects external changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setComposerEnterToSend(true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<GeneralSettingsPanels name="Test" />);
    });
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-enter-to-send-toggle"]',
    );
    if (!toggle) throw new Error("Missing Enter preference");
    expect(container.querySelector(`label[for="${toggle.id}"]`)?.textContent).toBe(
      "Send with Enter",
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(getComposerEnterToSend()).toBe(false);
    expect(localStorage.getItem(COMPOSER_ENTER_TO_SEND_STORAGE_KEY)).toBe("0");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => setComposerEnterToSend(true));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("shows usage totals and a per-model breakdown", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <UsageSettingsPanel
          usage={{
            runs: 2,
            inputTokens: 1200,
            outputTokens: 34,
            totalTokens: 1234,
            costUsd: 0.5,
            modelCalls: 3,
            models: [
              {
                provider: "openai",
                model: "model-a",
                modelCalls: 2,
                inputTokens: 1000,
                outputTokens: 30,
                totalTokens: 1030,
                costUsd: 0.5,
              },
              {
                provider: "local",
                model: "model-b",
                modelCalls: 1,
                inputTokens: 200,
                outputTokens: 4,
                totalTokens: 204,
                costUsd: null,
              },
            ],
          }}
        />,
      ),
    );
    expect([...container.querySelectorAll("dd")].map((node) => node.textContent)).toEqual([
      "2",
      "1,234",
      "$0.50",
    ]);
    expect(
      [...container.querySelectorAll("tbody tr")].map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["model-aopenai", "2", "1,000", "30", "$0.50"],
      ["model-blocal", "1", "200", "4", "—"],
    ]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("does not expose server integration configuration", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <GeneralSettingsPanels name="Jamie" />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('a[href="/integrations/setup"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("opens Advanced when search reveals one of its settings", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const advancedTrigger = () =>
    container.querySelector('[data-testid="advanced-settings"] [aria-expanded]');
  const renderPanels = (revealTarget: string | null) =>
    act(async () => root.render(<GeneralSettingsPanels name="Test" revealTarget={revealTarget} />));
  try {
    await renderPanels("theme");
    expect(advancedTrigger()?.getAttribute("aria-expanded")).toBe("false");
    await renderPanels("tool-activity");
    expect(advancedTrigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("#settings-target-tool-activity")).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("offers server settings only when the desktop app provides them", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const onOpenServerSettings = vi.fn();
  const serverButton = () =>
    container.querySelector<HTMLButtonElement>(
      '#settings-target-server-settings button[aria-label="Server settings"]',
    );
  try {
    await act(async () => root.render(<GeneralSettingsPanels name="Test" />));
    expect(serverButton()).toBeNull();
    await act(async () =>
      root.render(
        <GeneralSettingsPanels name="Test" onOpenServerSettings={onOpenServerSettings} />,
      ),
    );
    await act(async () => serverButton()?.click());
    expect(onOpenServerSettings).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
