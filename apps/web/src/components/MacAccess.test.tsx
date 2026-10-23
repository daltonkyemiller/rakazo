// @vitest-environment jsdom

import type { RakazoDesktop } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  me: vi.fn(),
  mcp: {
    servers: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    assignments: { list: vi.fn(), replace: vi.fn() },
  },
}));
vi.mock("../lib/rpc", () => ({ rpc: rpcMock }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
    <button type="button" {...props} />
  ),
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: ComponentProps<"button"> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
}));

import { MacAccessRow } from "./MacAccess";

const endpoint = "http://host.docker.internal:4555/mcp/host/computer/opaque";
const github = { serverId: "github", allowAllTools: false, allowedTools: ["search"] };
const macServer = (health: "unknown" | "error" = "unknown") => ({
  id: "mac-server",
  transport: "streamable_http",
  endpoint,
  enabled: true,
  health: { status: health },
});

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(<MacAccessRow botId="bot-1" />);
  });
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function macSwitch() {
  return container.querySelector<HTMLButtonElement>('[role="switch"]');
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  rpcMock.me.mockResolvedValue({
    spaceId: "space-1",
    computerHost: "docker",
    canChooseHostComputer: false,
  });
  rpcMock.mcp.servers.list.mockResolvedValue([]);
  rpcMock.mcp.assignments.list.mockResolvedValue([{ id: "a", botId: "bot-1", ...github }]);
  rpcMock.mcp.assignments.replace.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.rakazoDesktop;
  vi.clearAllMocks();
});

describe("MacAccessRow away from the Mac", () => {
  it("points to the Mac instead of offering a grant it cannot make", async () => {
    await render();
    expect(container.textContent).toContain("Allow it from Rakazo on your Mac.");
    expect(macSwitch()).toBeNull();
  });

  it("assigns an existing Mac server and keeps the bot's other servers", async () => {
    rpcMock.mcp.servers.list.mockResolvedValue([macServer()]);
    await render();
    expect(container.textContent).toContain("Commands and files");
    expect(macSwitch()?.getAttribute("aria-checked")).toBe("false");
    await act(async () => macSwitch()?.click());
    expect(rpcMock.mcp.assignments.replace).toHaveBeenCalledWith({
      botId: "bot-1",
      assignments: [github, { serverId: "mac-server", allowAllTools: true, allowedTools: [] }],
    });
  });

  it("asks for the Mac app only when the last check failed, and turns off just this bot", async () => {
    rpcMock.mcp.servers.list.mockResolvedValue([macServer("error")]);
    rpcMock.mcp.assignments.list.mockResolvedValue([
      { id: "a", botId: "bot-1", ...github },
      { id: "b", botId: "bot-1", serverId: "mac-server", allowAllTools: true, allowedTools: [] },
    ]);
    await render();
    expect(container.textContent).toContain("Open Rakazo on your Mac to use it.");
    await act(async () => macSwitch()?.click());
    expect(rpcMock.mcp.assignments.replace).toHaveBeenCalledWith({
      botId: "bot-1",
      assignments: [github],
    });
  });

  it("does not claim a status it has no evidence for", async () => {
    rpcMock.mcp.servers.list.mockResolvedValue([macServer()]);
    rpcMock.mcp.assignments.list.mockResolvedValue([
      { id: "b", botId: "bot-1", serverId: "mac-server", allowAllTools: true, allowedTools: [] },
    ]);
    await render();
    expect(container.textContent).toContain("Commands and files");
    expect(container.textContent).not.toContain("Open Rakazo");
    expect(macSwitch()?.getAttribute("aria-checked")).toBe("true");
  });

  it("explains that bots already run on the Mac in the legacy setup", async () => {
    rpcMock.me.mockResolvedValue({
      spaceId: "space-1",
      computerHost: "this-mac",
      canChooseHostComputer: false,
    });
    await render();
    expect(container.textContent).toContain("Bots already run on your Mac.");
    expect(macSwitch()).toBeNull();
  });
});

describe("MacAccessRow on the Mac", () => {
  it("registers this Mac after native approval, then assigns it", async () => {
    const mcp = {
      state: vi.fn(async () => ({ available: true, servers: [] })),
      add: vi.fn(async () => ({
        server: { id: "local-1", kind: "computer", endpoint, envKeys: [], enabled: true },
        token: "token-fixture",
      })),
      attach: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    window.rakazoDesktop = { platform: "darwin", mcp } as unknown as RakazoDesktop;
    rpcMock.mcp.servers.create.mockResolvedValue({ id: "mac-server", spaceId: "space-1" });
    await render();
    await act(async () => macSwitch()?.click());
    expect(mcp.add).toHaveBeenCalledWith({ kind: "computer", name: "Mac computer" });
    expect(mcp.attach).toHaveBeenCalledWith("local-1", "mac-server", "space-1");
    expect(rpcMock.mcp.assignments.replace).toHaveBeenCalledWith({
      botId: "bot-1",
      assignments: [github, { serverId: "mac-server", allowAllTools: true, allowedTools: [] }],
    });
  });

  it("shows the native error when this Mac's server is not running", async () => {
    window.rakazoDesktop = {
      platform: "darwin",
      mcp: {
        state: vi.fn(async () => ({
          available: true,
          servers: [
            {
              id: "local-1",
              kind: "computer",
              serverId: "mac-server",
              enabled: true,
              status: "error",
              error: "Port in use",
            },
          ],
        })),
      },
    } as unknown as RakazoDesktop;
    rpcMock.mcp.servers.list.mockResolvedValue([macServer()]);
    rpcMock.mcp.assignments.list.mockResolvedValue([
      { id: "b", botId: "bot-1", serverId: "mac-server", allowAllTools: true, allowedTools: [] },
    ]);
    await render();
    expect(container.textContent).toContain("Port in use");
  });
});
