// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
const { memoryConfigs, memoryConfigChange, providerConfig, updaterStatus } = vi.hoisted(() => ({
  memoryConfigs: [] as unknown[],
  memoryConfigChange: { current: (_config: unknown) => {} },
  providerConfig: vi.fn(async (_spaceId: string): Promise<unknown> => null),
  updaterStatus: vi.fn(async (): Promise<unknown> => ({ installKind: "compose" })),
}));
vi.mock("../lib/rpc", () => ({
  rpc: { updater: { status: updaterStatus } },
  createSpaceRpc: () => ({ memory: { providerConfig: () => providerConfig("") } }),
  selectedSpaceId: () => null,
  rpcForSpace: (spaceId: string) => ({
    memory: { providerConfig: () => providerConfig(spaceId) },
  }),
}));
vi.mock("./BillingSettingsPanel", () => ({ BillingSettingsPanel: () => null }));
vi.mock("./MemorySettingsOverlay", () => ({
  MemorySettingsOverlay: ({
    config,
    onConfigChange,
  }: {
    config: unknown;
    onConfigChange: (config: unknown) => void;
  }) => {
    memoryConfigs.push(config);
    memoryConfigChange.current = onConfigChange;
    return null;
  },
}));
vi.mock("./SpaceSettingsPanel", () => ({
  SpaceSettingsPanel: ({
    space,
    onDelete,
  }: {
    space: { name: string };
    onDelete: () => Promise<void>;
  }) => (
    <button type="button" data-testid="space-settings" onClick={() => void onDelete()}>
      {space.name}
    </button>
  ),
}));
const { scopes, recordScope } = vi.hoisted(() => {
  const scopes: string[] = [];
  return {
    scopes,
    recordScope:
      (name: string) =>
      ({ scope }: { scope: string }) => {
        scopes.push(`${name}:${scope}`);
        return null;
      },
  };
});
vi.mock("./ModelSettingsOverlay", () => ({ ModelSettingsOverlay: recordScope("models") }));
vi.mock("./VoiceSettingsOverlay", () => ({ VoiceSettingsOverlay: recordScope("voice") }));
vi.mock("../components/ApprovalRulesSettings", () => ({
  ApprovalRulesSettings: recordScope("confirmations"),
}));
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rerender = async (next: Partial<React.ComponentProps<typeof SettingsOverlay>>) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SettingsOverlay
            name="Jamie"
            onUsageOpen={() => undefined}
            timezone={null}
            onTimezoneChange={async () => undefined}
            memoryConfig={null}
            onMemoryConfigChange={() => undefined}
            onClose={() => undefined}
            section="general"
            {...next}
            onSectionChange={(section) => {
              next.onSectionChange?.(section);
              void rerender({ ...next, section });
            }}
          />
        </QueryClientProvider>,
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
    section: "memory",
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

it("opens the Space section for the space it acts on, with the space picker", async () => {
  const onDeleteSpace = vi.fn(async () => undefined);
  const { container, cleanup } = await render({
    space: { ...acme, canDelete: true },
    spaces,
    onSpaceChange: vi.fn(),
    onDeleteSpace,
    section: "space",
  });
  try {
    const nav = [...container.querySelectorAll('[data-testid^="settings-nav-"]')].map((item) =>
      item.getAttribute("data-testid"),
    );
    // The account's sections come first; the per-space ones sit together under the picker.
    expect(nav.slice(0, 6)).toEqual([
      "settings-nav-general",
      "settings-nav-models",
      "settings-nav-voice",
      "settings-nav-confirmations",
      "settings-nav-space",
      "settings-nav-memory",
    ]);
    expect(container.querySelector('[data-testid="settings-space"]')?.textContent).toBe("Acme");
    const panel = container.querySelector<HTMLButtonElement>('[data-testid="space-settings"]');
    expect(panel?.textContent).toBe("Acme");
    await act(async () => panel?.click());
    expect(onDeleteSpace).toHaveBeenCalledWith("space-a");
  } finally {
    await cleanup();
  }
});

it("reports a section picked in the nav so the shell can keep it in the URL", async () => {
  const onSectionChange = vi.fn();
  const { container, cleanup } = await render({ onSectionChange });
  try {
    const usage = container.querySelector<HTMLButtonElement>('[data-testid="settings-nav-usage"]');
    if (!usage) throw new Error("Missing Usage nav item");
    await act(async () => usage.click());
    expect(onSectionChange).toHaveBeenCalledWith("usage");
  } finally {
    await cleanup();
  }
});

it("opens a linked billing section once billing turns out to be on", async () => {
  const { container, rerender, cleanup } = await render({
    section: "billing",
    billingEnabled: false,
  });
  const shown = () =>
    container.querySelector("[data-settings-section]")?.getAttribute("data-settings-section");
  try {
    expect(shown()).toBe("general");
    await rerender({ section: "billing", billingEnabled: true });
    expect(shown()).toBe("billing");
  } finally {
    await cleanup();
  }
});

it("shows no space label or switcher when there is only one space", async () => {
  const { container, cleanup } = await render({
    space: acme,
    spaces: [acme],
    onSpaceChange: vi.fn(),
    section: "space",
  });
  try {
    expect(container.querySelector('[data-testid="settings-space"]')).toBeNull();
  } finally {
    await cleanup();
  }
});

it("shows no space picker on sections that are not per space", async () => {
  const { container, cleanup } = await render({
    space: acme,
    spaces,
    onSpaceChange: vi.fn(),
    section: "general",
  });
  try {
    expect(container.querySelector('[data-testid="settings-space"]')).toBeNull();
  } finally {
    await cleanup();
  }
});

it("edits the account's models, voice, and confirmations with no space picker", async () => {
  scopes.length = 0;
  const props = { space: acme, spaces, onSpaceChange: vi.fn() };
  const { container, rerender, cleanup } = await render({ ...props, section: "models" });
  try {
    for (const section of ["models", "voice", "confirmations"] as const) {
      await rerender({ ...props, section });
      expect(container.querySelector('[data-testid="settings-space"]')).toBeNull();
    }
    expect(new Set(scopes)).toEqual(
      new Set(["models:account", "voice:account", "confirmations:account"]),
    );
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
    section: "memory" as const,
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
    section: "memory",
    onMemoryConfigChange,
  });
  try {
    await vi.waitFor(() => expect(container.textContent).toContain("Memory service unavailable"));
    expect(memoryConfigs).not.toContain(null);
    const rendersBeforeRetry = memoryConfigs.length;
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    await vi.waitFor(() =>
      expect(container.textContent).not.toContain("Memory service unavailable"),
    );
    expect(memoryConfigs.length).toBeGreaterThan(rendersBeforeRetry);
    expect(memoryConfigs.at(-1)).toBeUndefined();
    expect(providerConfig.mock.calls.map(([spaceId]) => spaceId)).toEqual(["space-b", "space-b"]);
    const config = { provider: "mem0", defaultMemoryScope: "shared" };
    await act(async () => resolveRetry(config));
    await vi.waitFor(() => expect(memoryConfigs.at(-1)).toBe(config));
    expect(container.textContent).not.toContain("Retry");
    expect(onMemoryConfigChange).not.toHaveBeenCalled();
  } finally {
    await cleanup();
  }
});

it("keeps another space's saved memory config when an older read lands after it", async () => {
  memoryConfigs.length = 0;
  let resolveRead: (config: unknown) => void = () => undefined;
  providerConfig.mockReset().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  const { cleanup } = await render({
    space: spaces[1],
    currentSpaceId: "space-a",
    section: "memory",
  });
  try {
    await vi.waitFor(() => expect(providerConfig).toHaveBeenCalledTimes(1));
    const saved = { provider: "mem0", defaultMemoryScope: "shared" };
    await act(async () => memoryConfigChange.current(saved));
    await vi.waitFor(() => expect(memoryConfigs.at(-1)).toBe(saved));
    await act(async () => resolveRead(null));
    // Query updates reach components on a timer; let any late write land.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(memoryConfigs.at(-1)).toBe(saved);
  } finally {
    await cleanup();
  }
});

const updatesNav = (container: HTMLElement) =>
  container.querySelector('[data-testid="settings-nav-updates"]');

it("hides server updates and never requests server authority", async () => {
  const { container, cleanup } = await render({});
  try {
    expect(updatesNav(container)).toBeNull();
    expect(updaterStatus).not.toHaveBeenCalled();
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
  const { container, cleanup } = await render({ section: "usage" });
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
