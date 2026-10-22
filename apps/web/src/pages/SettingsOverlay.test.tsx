// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray) => strings.join(""),
    i18n: { locale: "en" },
  }),
}));

vi.mock("@rakazo/ui-web", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({
    children,
    showCloseButton: _showCloseButton,
    initialFocus: _initialFocus,
    ...props
  }: { children?: ReactNode; showCloseButton?: boolean; initialFocus?: unknown } & Omit<
    React.ComponentProps<"div">,
    "children"
  >) => <div {...props}>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
  OptionSelect: ({
    options,
    value,
    onValueChange,
    "data-testid": testId,
  }: {
    options: readonly { value: string; label: string }[];
    value: string;
    onValueChange: (value: string) => void;
    "data-testid"?: string;
  }) => (
    <div>
      <button type="button" data-testid={testId}>
        {options.find((option) => option.value === value)?.label}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={option.value === value}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./AccountSettingsOverlay", () => ({
  ComputerSettingsPanel: () => null,
  // Mirrors the real panel: Advanced rows stay hidden until a search reveals one of them.
  GeneralSettingsPanels: ({
    onOpenServerSettings,
    revealTarget,
  }: {
    onOpenServerSettings?: () => void;
    revealTarget?: string | null;
  }) => (
    <>
      <section id="settings-target-account">Account</section>
      {onOpenServerSettings ? (
        <div id="settings-target-server-settings">
          <button type="button" onClick={onOpenServerSettings}>
            Open
          </button>
        </div>
      ) : null}
      <div hidden={revealTarget !== "stream-replies"}>
        <div id="settings-target-stream-replies">
          <button type="button" role="switch" aria-checked="false">
            Stream replies
          </button>
        </div>
      </div>
    </>
  ),
  UpdatesSettingsPanel: () => null,
  UsageSettingsPanel: () => null,
}));
const passkeys = vi.hoisted(() => ({ supported: false }));
vi.mock("../lib/passkeys", () => ({ usePasskeysSupported: () => passkeys.supported }));
vi.mock("./memory-providers/registry", () => ({
  MEMORY_PROVIDER_SETTINGS: [{ id: "honcho", name: "Honcho" }],
}));
const { memoryConfigs, providerConfig, updaterStatus } = vi.hoisted(() => ({
  memoryConfigs: [] as unknown[],
  providerConfig: vi.fn(async (_spaceId: string): Promise<unknown> => null),
  updaterStatus: vi.fn(async (): Promise<unknown> => ({ installKind: "compose" })),
}));
vi.mock("../lib/rpc", () => ({
  rpc: { updater: { status: updaterStatus } },
  rpcForSpace: (spaceId: string) => ({
    memory: { providerConfig: () => providerConfig(spaceId) },
  }),
}));
vi.mock("./BillingSettingsPanel", () => ({ BillingSettingsPanel: () => null }));
vi.mock("./MemorySettingsOverlay", () => ({
  MemorySettingsOverlay: ({ config }: { config: unknown }) => {
    memoryConfigs.push(config);
    return null;
  },
}));
vi.mock("./ModelSettingsOverlay", () => ({ ModelSettingsOverlay: () => null }));
vi.mock("./VoiceSettingsOverlay", () => ({ VoiceSettingsOverlay: () => null }));
vi.mock("../components/ComputersUnavailableHint", () => ({
  computersAreUnavailable: () => false,
}));

import { SettingsOverlay } from "./SettingsOverlay";

const acme = { id: "space-a", name: "Acme" };
const spaces = [acme, { id: "space-b", name: "Beta" }];

async function render(props: Partial<React.ComponentProps<typeof SettingsOverlay>>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const rerender = async (next: Partial<React.ComponentProps<typeof SettingsOverlay>>) => {
    await act(async () => {
      root.render(
        <SettingsOverlay
          name="Jamie"
          onUsageOpen={() => undefined}
          avatarStyle="robot"
          onAvatarStyleChange={async () => undefined}
          timezone={null}
          onTimezoneChange={async () => undefined}
          memoryConfig={null}
          onMemoryConfigChange={() => undefined}
          onClose={() => undefined}
          {...next}
        />,
      );
    });
  };
  await rerender(props);
  return {
    container,
    rerender,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    },
  };
}

it("names the space a space-scoped section acts on and switches it in place", async () => {
  const onSpaceChange = vi.fn();
  const { container, cleanup } = await render({
    space: acme,
    spaces,
    onSpaceChange,
    initialSection: "models",
  });
  try {
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="settings-space"]');
    if (!trigger) throw new Error("Missing space switcher");
    expect(trigger.textContent).toBe("Acme");

    await act(async () => trigger.click());
    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(["Acme", "Beta"]);

    await act(async () => options[1]?.click());

    await vi.waitFor(() => expect(onSpaceChange).toHaveBeenCalledWith("space-b"));
  } finally {
    await cleanup();
  }
});

it("shows the space name without a switcher when there is only one space", async () => {
  const { container, cleanup } = await render({
    space: acme,
    spaces: [acme],
    onSpaceChange: vi.fn(),
    initialSection: "models",
  });
  try {
    const label = container.querySelector('[data-testid="settings-space"]');
    expect(label?.tagName).toBe("P");
    expect(label?.textContent).toBe("Acme");
  } finally {
    await cleanup();
  }
});

it("shows no space picker on sections that are not per space", async () => {
  const { container, cleanup } = await render({
    space: acme,
    spaces,
    onSpaceChange: vi.fn(),
    initialSection: "general",
  });
  try {
    expect(container.querySelector('[data-testid="settings-space"]')).toBeNull();
  } finally {
    await cleanup();
  }
});

it("never hands one space's memory config to another space's panel", async () => {
  const shared = { provider: "mem0", defaultMemoryScope: "shared" };
  providerConfig.mockImplementation(async (spaceId) => (spaceId === "space-b" ? shared : null));
  const gamma = { id: "space-c", name: "Gamma" };
  const props = {
    space: spaces[1],
    spaces: [...spaces, gamma],
    currentSpaceId: "space-a",
    onSpaceChange: vi.fn(),
    initialSection: "memory" as const,
  };
  const { rerender, cleanup } = await render(props);
  try {
    await vi.waitFor(() => expect(memoryConfigs.at(-1)).toBe(shared));
    memoryConfigs.length = 0;
    // The parent answers onSpaceChange by passing the new space back in.
    await rerender({ ...props, space: gamma });
    await vi.waitFor(() => expect(memoryConfigs.at(-1)).toBeNull());
    expect(memoryConfigs).not.toContain(shared);
  } finally {
    await cleanup();
  }
});

it("withholds memory connection controls after a failed load and retries the edited space", async () => {
  memoryConfigs.length = 0;
  providerConfig.mockReset();
  providerConfig.mockRejectedValueOnce(new Error("Memory service unavailable"));
  let resolveRetry: (config: unknown) => void = () => undefined;
  providerConfig.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRetry = resolve;
      }),
  );
  const onMemoryConfigChange = vi.fn();
  const { container, cleanup } = await render({
    space: spaces[1],
    currentSpaceId: "space-a",
    initialSection: "memory",
    onMemoryConfigChange,
  });
  try {
    expect(container.textContent).toContain("Memory service unavailable");
    expect(memoryConfigs).not.toContain(null);
    const rendersBeforeRetry = memoryConfigs.length;
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(container.textContent).not.toContain("Memory service unavailable");
    expect(memoryConfigs.length).toBeGreaterThan(rendersBeforeRetry);
    expect(memoryConfigs.at(-1)).toBeUndefined();
    expect(providerConfig.mock.calls.map(([spaceId]) => spaceId)).toEqual(["space-b", "space-b"]);
    const config = { provider: "mem0", defaultMemoryScope: "shared" };
    await act(async () => resolveRetry(config));
    expect(memoryConfigs.at(-1)).toBe(config);
    expect(container.textContent).not.toContain("Retry");
    expect(onMemoryConfigChange).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

const updatesNav = (container: HTMLElement) =>
  container.querySelector('[data-testid="settings-nav-updates"]');

it("hides Updates when neither the desktop app nor the server can update", async () => {
  const { container, cleanup } = await render({ isDeploymentOwner: true });
  try {
    await vi.waitFor(() => expect(updaterStatus).toHaveBeenCalled());
    expect(updatesNav(container)).toBeNull();
  } finally {
    await cleanup();
  }
});

it("shows Updates to the owner of a server that can update itself", async () => {
  updaterStatus.mockResolvedValueOnce({ installKind: "sidecar" });
  const { container, cleanup } = await render({ isDeploymentOwner: true });
  try {
    await vi.waitFor(() => expect(updatesNav(container)).not.toBeNull());
  } finally {
    await cleanup();
  }
});

it("shows Updates in the desktop app", async () => {
  vi.stubGlobal("rakazoDesktop", { update: {} });
  const { container, cleanup } = await render({});
  try {
    expect(updatesNav(container)).not.toBeNull();
  } finally {
    await cleanup();
  }
});

it("leaves Updates for General once the status shows nothing to update", async () => {
  let resolveStatus: (status: unknown) => void = () => undefined;
  updaterStatus.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
  );
  const { container, cleanup } = await render({
    isDeploymentOwner: true,
    initialSection: "updates",
  });
  const selected = () =>
    container.querySelector('[data-testid="user-settings"]')?.getAttribute("data-settings-section");
  try {
    expect(selected()).toBe("updates");
    await act(async () => resolveStatus({ installKind: "compose" }));
    expect(selected()).toBe("general");
  } finally {
    await cleanup();
  }
});

it("opens server controls from General through the desktop bridge", async () => {
  const openServer = vi.fn(async () => {});
  vi.stubGlobal("rakazoDesktop", { settings: { openServer }, update: {} });
  const { container, cleanup } = await render({});
  try {
    const button = container.querySelector<HTMLButtonElement>(
      "#settings-target-server-settings button",
    );
    if (!button) throw new Error("Missing server settings control");
    await act(async () => button.click());
    expect(openServer).toHaveBeenCalledOnce();
  } finally {
    await cleanup();
  }
});

const searchBox = (container: HTMLElement) => {
  const input = container.querySelector<HTMLInputElement>('[data-testid="settings-search"]');
  if (!input) throw new Error("Missing settings search");
  return input;
};

async function search(container: HTMLElement, query: string) {
  const input = searchBox(container);
  await act(async () => {
    // React tracks the input's value, so set it through the native setter.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return [...container.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
}

async function press(container: HTMLElement, key: string) {
  await act(async () => {
    searchBox(container).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

const selectedSection = (container: HTMLElement) =>
  container.querySelector('[data-testid="user-settings"]')?.getAttribute("data-settings-section");

it("finds individual settings by label and synonym across sections", async () => {
  const { container, cleanup } = await render({});
  try {
    expect((await search(container, "dark mode")).map((option) => option.textContent)).toEqual([
      "ThemeGeneral",
    ]);
    expect((await search(container, "fallback")).map((option) => option.textContent)).toEqual([
      "Backup modelsModels",
    ]);
    // Section names still match, ranked ahead of rows that only mention them.
    expect((await search(container, "voice"))[0]?.textContent).toBe("Voice");
    expect((await search(container, "honcho"))[0]?.textContent).toBe("Memory providerMemory");
    expect(await search(container, "zzz")).toEqual([]);
    expect(container.textContent).toContain("No results");
  } finally {
    await cleanup();
  }
});

it("only offers settings from sections and features that are available", async () => {
  const hidden = await render({});
  try {
    expect(await search(hidden.container, "invoice")).toEqual([]);
    expect(await search(hidden.container, "server settings")).toEqual([]);
    expect(await search(hidden.container, "messaging")).toEqual([]);
    expect(await search(hidden.container, "touch id")).toEqual([]);
  } finally {
    await hidden.cleanup();
  }
  passkeys.supported = true;
  vi.stubGlobal("rakazoDesktop", { settings: { openServer: vi.fn() } });
  const shown = await render({
    billingEnabled: true,
    messagingEnabled: true,
    onOpenMessaging: () => undefined,
  });
  try {
    expect((await search(shown.container, "invoice"))[0]?.textContent).toBe("Billing");
    expect((await search(shown.container, "server settings"))[0]?.textContent).toBe(
      "Server settingsGeneral",
    );
    expect((await search(shown.container, "messaging"))[0]?.textContent).toBe("MessagingGeneral");
    expect((await search(shown.container, "touch id"))[0]?.textContent).toBe("PasskeysGeneral");
  } finally {
    passkeys.supported = false;
    await shown.cleanup();
  }
});

it("moves through results with the keyboard and opens the chosen section", async () => {
  const { container, cleanup } = await render({});
  try {
    const input = searchBox(container);
    expect(input.getAttribute("role")).toBe("combobox");
    const options = await search(container, "backup");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    await press(container, "ArrowUp");
    expect(input.getAttribute("aria-activedescendant")).toBe(options.at(-1)?.id);
    await press(container, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    await press(container, "Enter");
    expect(selectedSection(container)).toBe("models");
    expect(input.value).toBe("");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="settings-nav-models"]')?.getAttribute("aria-current"),
    ).toBe("page");
  } finally {
    await cleanup();
  }
});

it("reveals a folded-away setting and focuses its control", async () => {
  const { container, cleanup } = await render({ initialSection: "usage" });
  try {
    const [streamReplies] = await search(container, "streaming");
    expect(streamReplies?.textContent).toBe("Stream repliesGeneral");
    await act(async () => streamReplies?.click());
    expect(selectedSection(container)).toBe("general");
    const target = container.querySelector("#settings-target-stream-replies");
    await vi.waitFor(() => expect(target?.hasAttribute("data-highlighted")).toBe(true));
    expect(document.activeElement?.textContent).toBe("Stream replies");
  } finally {
    await cleanup();
  }
});

it("clears the search on Escape before Escape can close settings", async () => {
  const { container, cleanup } = await render({});
  try {
    await search(container, "theme");
    await press(container, "Escape");
    expect(searchBox(container).value).toBe("");
    expect(container.querySelector('[data-testid="settings-nav"]')).not.toBeNull();
  } finally {
    await cleanup();
  }
});
