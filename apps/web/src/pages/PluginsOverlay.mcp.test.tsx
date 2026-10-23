// @vitest-environment jsdom

import type { Bot, BotMcpServer, McpServer, RakazoDesktop } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  connections: { catalog: vi.fn(), list: vi.fn(), tools: vi.fn() },
  capabilities: { list: vi.fn(), catalogSearch: vi.fn() },
  bots: { list: vi.fn() },
  mcp: {
    servers: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), test: vi.fn() },
    assignments: { all: vi.fn(), replace: vi.fn() },
    oauth: { disconnect: vi.fn() },
  },
}));

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values);
  return {
    useLingui: () => ({ t }),
    Trans: ({ children }: { children: ReactNode }) => children,
    Plural: ({ value, other }: { value: number; other: string }) => other.replace("#", `${value}`),
  };
});
vi.mock("../lib/rpc", () => ({ rpc }));
vi.mock("../lib/mcp-connect", () => ({
  MCP_OAUTH_CHANNEL: "test",
  mcpOAuthRedirectUri: () => "https://app.example.test/mcp/oauth/callback",
  connectMcpOauth: vi.fn(),
}));

import { PluginsOverlay } from "./PluginsOverlay";

const bot = (id: string, name: string) => ({ id, name, archivedAt: null }) as unknown as Bot;

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "srv-1",
    spaceId: "space-1",
    slug: "linear",
    name: "Linear",
    description: "",
    transport: "streamable_http",
    endpoint: "https://mcp.linear.app/mcp",
    command: null,
    args: [],
    envKeys: [],
    fileKeys: [],
    headerKeys: [],
    hasSecret: false,
    oauthStatus: "none",
    oauthClientId: null,
    health: { status: "unknown", message: null, toolCount: null, checkedAt: null },
    enabled: true,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;
let servers: McpServer[];
let assignments: BotMcpServer[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  servers = [];
  assignments = [
    {
      id: "a1",
      botId: "bot-1",
      serverId: "existing",
      allowAllTools: true,
      allowedTools: [],
      createdAt: "",
      updatedAt: "",
    },
  ];
  rpc.connections.catalog.mockResolvedValue([]);
  rpc.connections.list.mockResolvedValue([]);
  rpc.capabilities.list.mockResolvedValue([]);
  rpc.capabilities.catalogSearch.mockResolvedValue({ enabled: false, results: [] });
  rpc.bots.list.mockResolvedValue([bot("bot-1", "Scout"), bot("bot-2", "Atlas")]);
  rpc.mcp.servers.list.mockImplementation(async () => servers);
  rpc.mcp.assignments.all.mockImplementation(async () => assignments);
  rpc.mcp.assignments.replace.mockImplementation(
    async ({ botId, assignments: next }: { botId: string; assignments: BotMcpServer[] }) => {
      const updated = next.map((entry) => ({ ...entry, id: `${botId}:${entry.serverId}`, botId }));
      assignments = [...assignments.filter((entry) => entry.botId !== botId), ...updated];
      return updated;
    },
  );
  rpc.mcp.servers.create.mockImplementation(async (input: Record<string, unknown>) => {
    const created = server({
      id: `srv-${servers.length + 1}`,
      slug: input.slug as string,
      name: input.name as string,
      transport: input.transport as McpServer["transport"],
      endpoint: (input.endpoint as string | undefined) ?? null,
      command: (input.command as string | undefined) ?? null,
      args: (input.args as string[] | undefined) ?? [],
    });
    servers = [...servers, created];
    return created;
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete window.rakazoDesktop;
});

function byText(selector: string, text: string) {
  const match = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === text,
  );
  if (!match) throw new Error(`Missing ${selector} ${text}`);
  return match;
}

const button = (name: string) => byText("button", name);
const dialogs = () => document.querySelectorAll('[role="dialog"]');
const alertText = () =>
  [...document.querySelectorAll('[role="alert"]')].map((element) => element.textContent).join(" ");

function field(label: string) {
  const labelElement = byText("label", label);
  const id = labelElement.getAttribute("for");
  const element = id ? document.getElementById(id) : null;
  if (!element) throw new Error(`Missing field ${label}`);
  return element as HTMLInputElement | HTMLTextAreaElement;
}

function control(role: "switch" | "radio", label: string) {
  const labelElement = byText("label, span", label);
  const owner =
    labelElement.closest("label")?.querySelector(`[role="${role}"]`) ??
    document.querySelector(`[role="${role}"][aria-labelledby="${labelElement.id}"]`);
  if (!owner) throw new Error(`Missing ${role} ${label}`);
  return owner as HTMLElement;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = Object.getPrototypeOf(element) as object;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
}

async function openAdd(onClose = vi.fn()) {
  await act(async () => root.render(<PluginsOverlay onClose={onClose} />));
  await click(button("Add MCP server"));
  return onClose;
}

function hostBridge({ removeFails = false } = {}) {
  const mcp = {
    state: vi.fn(async () => ({ available: true, servers: [] })),
    add: vi.fn(async (input: { name: string }) => ({
      server: {
        id: "local-1",
        name: input.name,
        kind: "command" as const,
        endpoint: "http://host.docker.internal:7801/mcp/host/command/local-1",
        envKeys: [],
        enabled: true,
        status: "ready" as const,
      },
      token: "scoped-test-token",
    })),
    attach: vi.fn(async () => undefined),
    remove: vi.fn(async () => {
      if (removeFails) throw new Error("busy");
    }),
    setEnabled: vi.fn(async () => undefined),
    test: vi.fn(async () => ({ toolCount: 1 })),
  };
  window.rakazoDesktop = { mcp } as unknown as RakazoDesktop;
  return mcp;
}

it("adds a pasted URL as a remote server, grants agents, and navigates back in one dialog", async () => {
  const onClose = await openAdd();
  expect(dialogs()).toHaveLength(1);
  expect(document.activeElement).toBe(field("URL, command, or config"));

  await type(field("URL, command, or config"), "https://mcp.linear.app/sse");
  expect(field("Server name").value).toBe("Linear");
  expect(document.body.textContent).not.toContain("Runs on Rakazo server");
  await click(control("switch", "Scout"));
  await click(button("Add server"));

  expect(rpc.mcp.servers.create).toHaveBeenCalledWith(
    expect.objectContaining({
      slug: "linear",
      name: "Linear",
      transport: "sse",
      endpoint: "https://mcp.linear.app/sse",
      headers: {},
      enabled: true,
    }),
  );
  // Granting merges with the agent's existing servers instead of replacing them.
  expect(rpc.mcp.assignments.replace).toHaveBeenCalledWith({
    botId: "bot-1",
    assignments: [
      { serverId: "existing", allowAllTools: true, allowedTools: [] },
      { serverId: "srv-1", allowAllTools: true, allowedTools: [] },
    ],
  });
  const detail = document.querySelector('[data-testid="mcp-server-detail"]');
  expect(detail?.querySelector("h2")?.textContent).toBe("Linear");
  expect(detail?.textContent).toContain("Runs on mcp.linear.app");
  expect(control("switch", "Scout").getAttribute("aria-checked")).toBe("true");
  expect(dialogs()).toHaveLength(1);

  // Replacing the add page means Back lands on the list, then on the integrations catalog.
  await click(button("Back to integrations"));
  expect(document.querySelector('[data-testid="mcp-server-detail"]')).toBeNull();
  expect(document.querySelector('[data-testid="registered-mcp-server"]')?.textContent).toContain(
    "Linear",
  );
  expect(onClose).not.toHaveBeenCalled();
});

it("keeps quoted command arguments, clears placeholder secrets, and runs on the server without a Mac bridge", async () => {
  await openAdd();
  await type(
    field("URL, command, or config"),
    JSON.stringify({
      mcpServers: {
        files: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/srv/My Docs"],
          env: { API_KEY: "YOUR_API_KEY" },
        },
      },
    }),
  );
  expect(document.body.textContent).toContain("Runs on Rakazo server");
  expect(document.querySelectorAll('[role="radio"]')).toHaveLength(0);
  const value = document.querySelector<HTMLInputElement>('input[aria-label="Value"]');
  expect(value?.type).toBe("password");
  expect(value?.value).toBe("");

  await click(button("Add server"));
  expect(rpc.mcp.servers.create).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Add a value for API_KEY.");
  expect(document.activeElement).toBe(value);

  await type(value as HTMLInputElement, "real-key");
  await act(async () => {
    (document.querySelector('[data-testid="mcp-server-draft"]') as HTMLFormElement).requestSubmit();
  });
  expect(rpc.mcp.servers.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "files",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/srv/My Docs"],
      env: { API_KEY: "real-key" },
    }),
  );
});

it("shows backend errors inline when the server cannot run commands", async () => {
  rpc.mcp.servers.create.mockRejectedValueOnce(new Error("Local MCP commands are disabled"));
  await openAdd();
  await type(field("URL, command, or config"), "uvx mcp-server-fetch");
  await click(button("Add server"));
  expect(alertText()).toContain("Local MCP commands are disabled");
  expect(document.querySelector('[data-testid="mcp-server-draft"]')).not.toBeNull();
});

it("refuses shell evaluation instead of splitting on whitespace", async () => {
  await openAdd();
  const source = field("URL, command, or config");
  await type(source, "npx server --token $TOKEN");
  await act(async () => {
    source.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(alertText()).toContain("Shell variables, pipes, and substitutions are not run.");
  expect(document.querySelector('[data-testid="mcp-server-draft"]')).toBeNull();
});

it("asks where a command runs on a Mac and registers it with a scoped token", async () => {
  const mcp = hostBridge();
  await openAdd();
  await type(field("URL, command, or config"), `npx -y notes-mcp --vault "/Users/me/My Notes"`);
  await click(button("Add server"));
  expect(alertText()).toContain("Choose where it runs.");
  expect(mcp.add).not.toHaveBeenCalled();

  await click(control("radio", "This Mac"));
  // Cmd+Enter in the source field submits without reaching for the button.
  field("URL, command, or config").focus();
  await press("Enter", { metaKey: true });

  expect(mcp.add).toHaveBeenCalledWith({
    kind: "command",
    name: "Notes",
    command: "npx",
    args: ["-y", "notes-mcp", "--vault", "/Users/me/My Notes"],
    cwd: undefined,
    env: {},
  });
  expect(rpc.mcp.servers.create).toHaveBeenCalledWith(
    expect.objectContaining({
      transport: "streamable_http",
      endpoint: "http://host.docker.internal:7801/mcp/host/command/local-1",
      secret: "scoped-test-token",
    }),
  );
  expect(JSON.stringify(rpc.mcp.servers.create.mock.calls[0])).not.toContain("My Notes");
  expect(mcp.attach).toHaveBeenCalledWith("local-1", "srv-1", "space-1");
});

it("removes the Mac registration when the backend rejects it, and stops when consent is declined", async () => {
  const mcp = hostBridge();
  rpc.mcp.servers.create.mockRejectedValueOnce(new Error("Endpoint not allowed"));
  await openAdd();
  await type(field("URL, command, or config"), "node /opt/weather/build/index.js");
  await click(control("radio", "This Mac"));
  await click(button("Add server"));
  expect(mcp.remove).toHaveBeenCalledWith("local-1");
  expect(alertText()).toContain("Endpoint not allowed");

  mcp.add.mockResolvedValueOnce(null as never);
  rpc.mcp.servers.create.mockClear();
  await click(button("Add server"));
  expect(rpc.mcp.servers.create).not.toHaveBeenCalled();
  expect(alertText()).not.toContain("Could not");
});

it("reports a Mac registration that could not be cleaned up", async () => {
  hostBridge({ removeFails: true });
  rpc.mcp.servers.create.mockRejectedValueOnce(new Error("Endpoint not allowed"));
  await openAdd();
  await type(field("URL, command, or config"), "node /opt/weather/build/index.js");
  await click(control("radio", "This Mac"));
  await click(button("Add server"));
  expect(alertText()).toContain(
    "Could not add Weather, and its setup on this Mac could not be removed.",
  );
});

it("lets a multi-server config pick one server at a time", async () => {
  await openAdd();
  await type(
    field("URL, command, or config"),
    JSON.stringify({
      mcpServers: {
        linear: { url: "https://mcp.linear.app/mcp" },
        github: { url: "https://api.githubcopilot.example/mcp" },
      },
    }),
  );
  expect(document.querySelector('[data-testid="mcp-server-draft"]')).toBeNull();
  await click(control("radio", "github"));
  expect(field("Server name").value).toBe("github");
  await click(button("Add server"));
  expect(rpc.mcp.servers.create).toHaveBeenCalledWith(
    expect.objectContaining({ name: "github", endpoint: "https://api.githubcopilot.example/mcp" }),
  );
  // The other server stays available; the added one is marked.
  expect(document.querySelector('[data-testid="mcp-server-draft"]')).toBeNull();
  expect(document.body.textContent).toContain("Added");
});

it("lists servers from older releases without health and never tests them on its own", async () => {
  const legacy = server({ id: "legacy", name: "Legacy" }) as Partial<McpServer>;
  delete legacy.health;
  delete legacy.oauthStatus;
  delete legacy.fileKeys;
  servers = [legacy as McpServer];
  await act(async () => root.render(<PluginsOverlay onClose={vi.fn()} />));
  const row = document.querySelector<HTMLButtonElement>('[data-testid="registered-mcp-server"]');
  expect(row?.textContent).toContain("mcp.linear.app");
  await click(row as HTMLButtonElement);

  expect(document.activeElement).toBe(button("Back to integrations"));
  expect(document.querySelector('[data-testid="mcp-server-detail"]')).not.toBeNull();
  expect(() => button("Test connection")).toThrow();
  expect(() => button("Connect OAuth")).toThrow();
  expect(rpc.mcp.servers.test).not.toHaveBeenCalled();

  // Escape backs out to the catalog and returns focus to the row that opened the server.
  await press("Escape");
  expect(document.querySelector('[data-testid="mcp-server-detail"]')).toBeNull();
  expect(document.activeElement).toBe(
    document.querySelector('[data-testid="registered-mcp-server"]'),
  );
});

it("opens a server from the list and returns focus to its row", async () => {
  servers = [
    server({
      health: { status: "error", message: "boom", toolCount: null, checkedAt: null },
    }),
  ];
  await act(async () => root.render(<PluginsOverlay onClose={vi.fn()} />));
  await click(button("Manage MCP servers"));
  const row = document.querySelector('[data-testid="mcp-server-row"]');
  expect(row?.textContent).toContain("Not working");
  await click(row as Element);
  await click(button("Back to MCP servers"));
  expect(document.activeElement).toBe(document.querySelector('[data-testid="mcp-server-row"]'));

  await click(document.querySelector('[data-testid="mcp-server-row"]') as Element);
  await click(button("Remove"));
  expect(rpc.mcp.servers.remove).not.toHaveBeenCalled();
  await click(button("Confirm remove"));
  expect(rpc.mcp.servers.remove).toHaveBeenCalledWith({ id: "srv-1" });
});

it.each([
  [403, 2],
  [404, 2],
  [503, 4],
])("after a %i install poll, polling makes %i list requests", async (status, requests) => {
  vi.useFakeTimers();
  servers = [
    server({
      transport: "stdio",
      endpoint: null,
      command: "npx",
      health: { status: "installing", message: null, toolCount: null, checkedAt: null },
    }),
  ];
  try {
    await act(async () => root.render(<PluginsOverlay onClose={vi.fn()} />));
    await click(button("Manage MCP servers"));
    rpc.mcp.servers.list
      .mockClear()
      .mockResolvedValueOnce(servers)
      .mockRejectedValueOnce(Object.assign(new Error("Refused"), { status }))
      .mockImplementation(async () => servers);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    // One request per tick; a non-retryable failure stops polling, a retryable one does not.
    expect(rpc.mcp.servers.list).toHaveBeenCalledTimes(requests);
  } finally {
    vi.useRealTimers();
  }
});
