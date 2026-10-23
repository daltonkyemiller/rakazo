// @vitest-environment jsdom

import type { Me, RakazoDesktop } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  me: vi.fn(),
  bots: { get: vi.fn() },
  deployment: { update: vi.fn() },
  mcp: {
    servers: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    assignments: { list: vi.fn(), replace: vi.fn() },
  },
}));
vi.mock("../lib/rpc", () => ({ rpc: rpcMock }));
vi.mock("react-router-dom", () => ({ useParams: () => ({ botId: "bot-1" }) }));
vi.mock("../components/MacAccess", () => ({ MacAccessRow: () => null }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo/ui-web", () => {
  const Plain = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & { variant?: string; size?: string }) => (
      <button type="button" {...props} />
    ),
    Dialog: Plain,
    DialogContent: Plain,
    DialogDescription: Plain,
    DialogHeader: Plain,
    DialogTitle: Plain,
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
  };
});

import { HostComputerPrompt } from "./HostComputerPrompt";

const endpoint = "http://host.docker.internal:4555/mcp/host/computer/opaque";
const owner = {
  spaceId: "space-1",
  canChooseHostComputer: true,
  computerHost: null,
} as unknown as Me;

let container: HTMLDivElement;
let root: Root;
let configure: (() => void) | undefined;
const computer = {
  requestAccess: vi.fn(async () => true),
  revokeAccess: vi.fn(async () => undefined),
  onConfigure: vi.fn((listener: () => void) => {
    configure = listener;
    return () => undefined;
  }),
};
const mcp = {
  state: vi.fn(),
  add: vi.fn(),
  attach: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  setEnabled: vi.fn(async () => undefined),
  test: vi.fn(),
};

function installDesktop(withMacBridge: boolean) {
  window.rakazoDesktop = {
    platform: "darwin",
    computer,
    ...(withMacBridge ? { mcp } : {}),
  } as unknown as RakazoDesktop;
}

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function render(initialMe?: Me) {
  await act(async () => {
    root.render(<HostComputerPrompt initialMe={initialMe} />);
  });
  await flush();
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`No button named ${label}`);
  await act(async () => button.click());
  await flush();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  configure = undefined;
  mcp.state.mockResolvedValue({ available: true, servers: [] });
  rpcMock.me.mockResolvedValue(owner);
  rpcMock.bots.get.mockResolvedValue({ id: "bot-1", name: "Ada" });
  rpcMock.deployment.update.mockResolvedValue({});
  rpcMock.mcp.servers.list.mockResolvedValue([]);
  rpcMock.mcp.assignments.list.mockResolvedValue([
    { id: "a", botId: "bot-1", serverId: "github", allowAllTools: true, allowedTools: [] },
  ]);
  rpcMock.mcp.assignments.replace.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.rakazoDesktop;
  vi.clearAllMocks();
});

describe("HostComputerPrompt", () => {
  it("keeps the either/or choice and its revoke on desktops without the Mac bridge", async () => {
    installDesktop(false);
    await render(owner);
    expect(container.textContent).toContain("Where should bots run?");
    await click("Docker");
    expect(computer.revokeAccess).toHaveBeenCalledOnce();
    expect(rpcMock.deployment.update).toHaveBeenCalledWith({ computerHost: "docker" });
  });

  it("saves isolated computers on first run without revoking Mac access", async () => {
    installDesktop(true);
    await render(owner);
    expect(container.textContent).not.toContain("Where should bots run?");
    await click("Continue");
    expect(rpcMock.deployment.update).toHaveBeenCalledWith({ computerHost: "docker" });
    expect(computer.revokeAccess).not.toHaveBeenCalled();
    expect(mcp.add).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("gives bots their own computers and keeps Mac access for the selected bot", async () => {
    installDesktop(true);
    rpcMock.me.mockResolvedValue({ ...owner, computerHost: "this-mac" });
    mcp.add.mockResolvedValue({
      server: { id: "local-1", kind: "computer", endpoint, envKeys: [], enabled: true },
      token: "token-fixture",
    });
    rpcMock.mcp.servers.create.mockResolvedValue({ id: "mac-server", spaceId: "space-1" });
    await render();
    await act(async () => configure?.());
    await flush();
    expect(container.textContent).toContain("Bots run directly on this Mac.");
    await click("Use isolated computers");
    expect(container.textContent).toContain("Mac access for Ada");
    expect(rpcMock.deployment.update).not.toHaveBeenCalled();
    await click("Switch");

    expect(mcp.add).toHaveBeenCalledWith({ kind: "computer", name: "Mac computer" });
    expect(mcp.attach).toHaveBeenCalledWith("local-1", "mac-server", "space-1");
    expect(rpcMock.mcp.assignments.replace).toHaveBeenCalledWith({
      botId: "bot-1",
      assignments: [
        { serverId: "github", allowAllTools: true, allowedTools: [] },
        { serverId: "mac-server", allowAllTools: true, allowedTools: [] },
      ],
    });
    expect(rpcMock.deployment.update).toHaveBeenCalledWith({ computerHost: "docker" });
    expect(computer.revokeAccess).not.toHaveBeenCalled();
    expect(computer.requestAccess).not.toHaveBeenCalled();
  });

  it("reuses this Mac's approved server instead of asking again", async () => {
    installDesktop(true);
    rpcMock.me.mockResolvedValue({ ...owner, computerHost: "this-mac" });
    mcp.state.mockResolvedValue({
      available: true,
      servers: [{ id: "local-1", kind: "computer", serverId: "mac-server", enabled: true }],
    });
    rpcMock.mcp.servers.list.mockResolvedValue([
      { id: "mac-server", transport: "streamable_http", endpoint, enabled: true },
    ]);
    await render();
    await act(async () => configure?.());
    await flush();
    await click("Use isolated computers");
    await click("Switch");
    expect(mcp.add).not.toHaveBeenCalled();
    expect(rpcMock.mcp.assignments.replace).toHaveBeenCalledOnce();
    expect(rpcMock.deployment.update).toHaveBeenCalledWith({ computerHost: "docker" });
  });

  it("stays on this Mac when the Mac prompt is declined", async () => {
    installDesktop(true);
    rpcMock.me.mockResolvedValue({ ...owner, computerHost: "this-mac" });
    mcp.add.mockResolvedValue(null);
    await render();
    await act(async () => configure?.());
    await flush();
    await click("Use isolated computers");
    await click("Switch");
    expect(rpcMock.mcp.servers.create).not.toHaveBeenCalled();
    expect(rpcMock.deployment.update).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Mac access for Ada");
  });

  it("can switch without Mac access when the person turns it off", async () => {
    installDesktop(true);
    rpcMock.me.mockResolvedValue({ ...owner, computerHost: "this-mac" });
    await render();
    await act(async () => configure?.());
    await flush();
    await click("Use isolated computers");
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
    await click("Switch");
    expect(mcp.add).not.toHaveBeenCalled();
    expect(rpcMock.mcp.assignments.replace).not.toHaveBeenCalled();
    expect(rpcMock.deployment.update).toHaveBeenCalledWith({ computerHost: "docker" });
  });
});
