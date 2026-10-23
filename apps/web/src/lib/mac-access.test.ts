import { afterEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => ({
  mcp: {
    servers: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    assignments: { list: vi.fn(), replace: vi.fn() },
  },
}));
vi.mock("./rpc", () => ({ rpc: rpcMock }));

import { ensureMacComputer, registerMacComputer, setBotMacAccess } from "./mac-access";
import type { HostMcpBridge } from "./mcp-host";
import { HostMcpCleanupError } from "./mcp-host";

const endpoint = "http://host.docker.internal:4555/mcp/host/computer/opaque";

function desktopMcp(overrides: Partial<HostMcpBridge> = {}): HostMcpBridge {
  return {
    state: vi.fn(async () => ({ available: true, servers: [] })),
    add: vi.fn(async () => ({
      server: {
        id: "local-1",
        name: "Mac computer",
        kind: "computer" as const,
        endpoint,
        envKeys: [],
        enabled: true,
        status: "ready" as const,
      },
      token: "token-fixture",
    })),
    attach: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    setEnabled: vi.fn(async () => undefined),
    test: vi.fn(async () => ({ toolCount: 5 })),
    ...overrides,
  };
}

afterEach(() => vi.resetAllMocks());

describe("registerMacComputer", () => {
  it("stops before the backend when the Mac prompt is declined", async () => {
    const mcp = desktopMcp({ add: vi.fn(async () => null) });
    rpcMock.mcp.servers.list.mockResolvedValue([]);
    await expect(registerMacComputer(mcp)).resolves.toBeNull();
    expect(rpcMock.mcp.servers.create).not.toHaveBeenCalled();
  });

  it("registers the server with its token and attaches it to the space", async () => {
    const mcp = desktopMcp();
    rpcMock.mcp.servers.list.mockResolvedValue([{ slug: "mac-computer" }]);
    rpcMock.mcp.servers.create.mockResolvedValue({ id: "server-1", spaceId: "space-1" });
    await expect(registerMacComputer(mcp)).resolves.toEqual({ id: "server-1", spaceId: "space-1" });
    expect(rpcMock.mcp.servers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "mac-computer-2",
        transport: "streamable_http",
        endpoint,
        secret: "token-fixture",
        enabled: true,
      }),
    );
    expect(mcp.attach).toHaveBeenCalledWith("local-1", "server-1", "space-1");
  });

  it("removes the native registration when the backend refuses it", async () => {
    const mcp = desktopMcp();
    const refused = new Error("refused");
    rpcMock.mcp.servers.list.mockResolvedValue([]);
    rpcMock.mcp.servers.create.mockRejectedValue(refused);
    await expect(registerMacComputer(mcp)).rejects.toBe(refused);
    expect(mcp.remove).toHaveBeenCalledWith("local-1");
    expect(mcp.attach).not.toHaveBeenCalled();
  });

  it("reports when the orphaned native registration cannot be removed", async () => {
    const mcp = desktopMcp({ remove: vi.fn(async () => Promise.reject(new Error("busy"))) });
    rpcMock.mcp.servers.list.mockResolvedValue([]);
    rpcMock.mcp.servers.create.mockRejectedValue(new Error("refused"));
    await expect(registerMacComputer(mcp)).rejects.toBeInstanceOf(HostMcpCleanupError);
  });

  it("rolls both registrations back when attaching fails", async () => {
    const mcp = desktopMcp({ attach: vi.fn(async () => Promise.reject(new Error("gone"))) });
    rpcMock.mcp.servers.list.mockResolvedValue([]);
    rpcMock.mcp.servers.create.mockResolvedValue({ id: "server-1", spaceId: "space-1" });
    rpcMock.mcp.servers.remove.mockResolvedValue({ ok: true });
    await expect(registerMacComputer(mcp)).rejects.toThrow("gone");
    expect(rpcMock.mcp.servers.remove).toHaveBeenCalledWith({ id: "server-1" });
    expect(mcp.remove).toHaveBeenCalledWith("local-1");
  });
});

describe("setBotMacAccess", () => {
  const github = { serverId: "github", allowAllTools: false, allowedTools: ["search"] };

  it("adds Mac access alongside the bot's other servers", async () => {
    rpcMock.mcp.assignments.list.mockResolvedValue([{ id: "a", botId: "bot-1", ...github }]);
    rpcMock.mcp.servers.list.mockResolvedValue([]);
    await setBotMacAccess("bot-1", "mac");
    expect(rpcMock.mcp.assignments.replace).toHaveBeenCalledWith({
      botId: "bot-1",
      assignments: [github, { serverId: "mac", allowAllTools: true, allowedTools: [] }],
    });
  });

  it("removes only Mac servers when turned off", async () => {
    rpcMock.mcp.assignments.list.mockResolvedValue([
      { id: "a", botId: "bot-1", ...github },
      { id: "b", botId: "bot-1", serverId: "mac", allowAllTools: true, allowedTools: [] },
    ]);
    rpcMock.mcp.servers.list.mockResolvedValue([
      { id: "github", transport: "streamable_http", endpoint: "https://example.test/mcp" },
      { id: "mac", transport: "streamable_http", endpoint },
    ]);
    await setBotMacAccess("bot-1", null);
    expect(rpcMock.mcp.assignments.replace).toHaveBeenCalledWith({
      botId: "bot-1",
      assignments: [github],
    });
  });
});

describe("ensureMacComputer", () => {
  it("requires fresh native consent after revocation and keeps a decline disabled", async () => {
    const local = {
      id: "local-1",
      serverId: "server-1",
      kind: "computer" as const,
      name: "Mac computer",
      endpoint,
      envKeys: [],
      enabled: false,
      status: "stopped" as const,
    };
    const bridge = desktopMcp({
      state: vi.fn(async () => ({ available: true, servers: [local] })),
    });
    rpcMock.mcp.servers.list.mockResolvedValue([
      { id: "server-1", transport: "streamable_http", endpoint, enabled: true },
    ]);
    await expect(ensureMacComputer(bridge)).resolves.toBeNull();
    expect(bridge.setEnabled).toHaveBeenCalledWith("local-1", true);
    expect(bridge.add).not.toHaveBeenCalled();
    expect(rpcMock.mcp.servers.update).not.toHaveBeenCalled();
  });
});
