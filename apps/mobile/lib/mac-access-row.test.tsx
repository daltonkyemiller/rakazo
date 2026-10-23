// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  me: { computerHost: "docker" as string | null },
  servers: [] as unknown[],
  assignments: [] as unknown[],
}));

vi.mock("./api", () => ({
  rpc: async (procedure: string, input?: unknown) => {
    if (procedure === "me") return mocks.me;
    if (procedure === "mcp/servers/list") return mocks.servers;
    if (procedure === "mcp/assignments/list") return mocks.assignments;
    return mocks.rpc(procedure, input);
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Text: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
}));
vi.mock("./native", () => ({
  useMobileTokens: () => ({ mutedForeground: "muted", foreground: "ink", destructive: "error" }),
}));
vi.mock("./i18n", () => {
  const t = (text: string) => text;
  return { t, useI18n: () => ({ t }) };
});
vi.mock("../components/native-switch", () => ({
  NativeSwitch: ({
    onValueChange,
    value,
  }: {
    onValueChange: (value: boolean) => void;
    value: boolean;
  }) =>
    createElement("button", {
      type: "button",
      role: "switch",
      "aria-checked": value,
      onClick: () => onValueChange(!value),
    }),
}));

import { MacAccessRow } from "../components/mac-access-row";

const github = { serverId: "github", allowAllTools: false, allowedTools: ["search"] };
const macServer = {
  id: "mac-server",
  transport: "streamable_http",
  endpoint: "http://host.docker.internal:4555/mcp/host/computer/opaque",
  enabled: true,
  health: { status: "unknown" },
};

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => root.render(createElement(MacAccessRow, { botId: "bot-1" })));
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mocks.me = { computerHost: "docker" };
  mocks.servers = [];
  mocks.assignments = [{ id: "a", botId: "bot-1", ...github }];
  mocks.rpc.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("mobile MacAccessRow", () => {
  it("sends the person to their Mac when no Mac is approved yet", async () => {
    await render();
    expect(container.textContent).toContain("Allow it from Rakazo on your Mac.");
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });

  it("turns on an approved Mac for this bot without dropping other servers", async () => {
    mocks.servers = [macServer];
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    expect(mocks.rpc).toHaveBeenCalledWith("mcp/assignments/replace", {
      botId: "bot-1",
      assignments: [github, { serverId: "mac-server", allowAllTools: true, allowedTools: [] }],
    });
  });

  it("keeps the legacy setup without a switch", async () => {
    mocks.me = { computerHost: "this-mac" };
    await render();
    expect(container.textContent).toContain("Bots already run on your Mac.");
    expect(container.querySelector('[role="switch"]')).toBeNull();
  });
});
