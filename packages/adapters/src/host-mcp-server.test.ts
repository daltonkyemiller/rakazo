import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostMcpEntry } from "./host-mcp-server.js";
import { startHostMcpServer } from "./host-mcp-server.js";

const fixture = fileURLToPath(new URL("./fixtures/host-mcp-fixture.mjs", import.meta.url));
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  vi.unstubAllEnvs();
});
async function setup(kind: "command" | "computer" = "command", env: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "rakazo-host-mcp-test-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  if (kind === "computer") {
    vi.stubEnv("HOME", root);
    vi.stubEnv("SHELL", "/bin/sh");
  }
  const launches = path.join(root, "launches");
  const started = path.join(root, "started");
  const entry: HostMcpEntry = {
    id: randomUUID(),
    token: randomBytes(32).toString("hex"),
    enabled: true,
    input: {
      kind,
      name: "Offline test",
      command: process.execPath,
      args: [fixture],
      env: { FIXTURE_LAUNCHES: launches, FIXTURE_STARTED: started, ...env },
    },
  };
  let active = true;
  const bridge = await startHostMcpServer({
    root,
    entries: [entry],
    hostname: "127.0.0.1",
    isActive: () => active,
  });
  cleanups.push(() => bridge.close());
  const endpoint = `http://127.0.0.1:${bridge.port}/mcp/host/${kind}/${entry.id}`;
  return {
    root,
    entry,
    bridge,
    endpoint,
    launches,
    started,
    deactivate: () => {
      active = false;
    },
  };
}
async function client(endpoint: string, token: string) {
  const client = new Client({ name: "offline-test", version: "1" });
  cleanups.push(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
async function exists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  );
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("host MCP bridge", () => {
  it("authenticates before launch and rejects browser, kind, query, and path variants", async () => {
    const { endpoint, launches, entry } = await setup();
    const rejectedHeaders: Record<string, string>[] = [
      {},
      { Authorization: "Bearer wrong" },
      { Authorization: `Bearer ${entry.token}`, Origin: "" },
      { Authorization: `Bearer ${entry.token}`, "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of rejectedHeaders) {
      expect((await fetch(endpoint, { method: "POST", headers, body: "{}" })).status).toBe(401);
    }
    for (const url of [
      endpoint.replace("/command/", "/computer/"),
      `${endpoint}?x=1`,
      `${endpoint}/`,
      endpoint.replace(entry.id, "../bad"),
    ]) {
      expect((await fetch(url, { method: "POST" })).status).toBe(404);
    }
    expect(await exists(launches)).toBe(false);
  });

  it("forwards SDK tool results, isolates environment, and caches one process", async () => {
    vi.stubEnv("RAKAZO_TEST_BACKEND_SECRET", "fake-backend-secret");
    const { bridge, endpoint, entry, launches } = await setup("command", {
      FIXTURE_SECRET: "fake-configured-value",
    });
    const connection = await client(endpoint, entry.token);
    expect(await exists(launches)).toBe(false);
    expect(await bridge.test(entry.id)).toEqual({ toolCount: 1 });
    expect((await connection.listTools()).tools.map((tool) => tool.name)).toEqual(["echo"]);
    const result = await connection.callTool({
      name: "echo",
      arguments: { fail: true, literal: "$(no-shell)" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          args: { fail: true, literal: "$(no-shell)" },
          configured: "fake-configured-value",
          inherited: null,
          pid: Number((await readFile(launches, "utf8")).trim()),
        }),
      },
    ]);
    expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(1);
    expect(bridge.status(entry.id)).toEqual({ status: "ready" });
  });

  it("keeps credentials isolated and rejects all routes and tests after disable or inactivity", async () => {
    const { bridge, endpoint, entry, launches, deactivate } = await setup();
    const second = { ...entry, id: randomUUID(), token: randomBytes(32).toString("hex") };
    bridge.add(second);
    expect(
      (
        await fetch(endpoint.replace(entry.id, second.id), {
          method: "POST",
          headers: { Authorization: `Bearer ${entry.token}` },
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect(() => bridge.add({ ...second, id: randomUUID(), token: entry.token })).toThrow("unique");
    await bridge.setEnabled(entry.id, false);
    await expect(bridge.test(entry.id)).rejects.toThrow();
    expect(
      (await fetch(endpoint, { headers: { Authorization: `Bearer ${entry.token}` } })).status,
    ).toBe(403);
    await bridge.setEnabled(entry.id, true);
    deactivate();
    await expect(bridge.test(entry.id)).rejects.toThrow();
    expect(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${entry.token}` },
        })
      ).status,
    ).toBe(403);
    expect(await exists(launches)).toBe(false);
  });

  it("kills cached processes on disable and permits a new explicit connection", async () => {
    const { bridge, entry, launches } = await setup();
    await bridge.test(entry.id);
    const pid = Number((await readFile(launches, "utf8")).trim());
    expect(alive(pid)).toBe(true);
    await bridge.setEnabled(entry.id, false);
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    await bridge.setEnabled(entry.id, true);
    await bridge.test(entry.id);
    expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("cancels startup during revocation without letting a late process escape", async () => {
    const { bridge, entry, launches } = await setup("command", { FIXTURE_SLOW: "1" });
    const pending = bridge.test(entry.id).catch((error: unknown) => error);
    await vi.waitFor(async () => expect(await exists(launches)).toBe(true));
    const pid = Number((await readFile(launches, "utf8")).trim());
    await bridge.remove(entry.id);
    expect(await pending).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    expect(() => bridge.status(entry.id)).toThrow("not found");
  });

  it("redacts failed startup diagnostics and retries only on explicit test", async () => {
    const { bridge, entry, launches } = await setup("command", {
      FIXTURE_FAIL: "1",
      FIXTURE_SECRET: "fake-sensitive-env-value",
    });
    await expect(bridge.test(entry.id)).rejects.toThrow("Check the approved command");
    expect(JSON.stringify(bridge.status(entry.id))).not.toContain("fake-sensitive-env-value");
    expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(1);
    await expect(bridge.test(entry.id)).rejects.toThrow();
    expect((await readFile(launches, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("aborts outstanding HTTP calls and idle processes when the app becomes inactive", async () => {
    const { bridge, entry, endpoint, launches, started, deactivate } = await setup();
    const connection = await client(endpoint, entry.token);
    const pending = connection
      .callTool({ name: "echo", arguments: { wait: true } })
      .catch((error: unknown) => error);
    await vi.waitFor(async () => expect(await exists(started)).toBe(true));
    const pid = Number((await readFile(launches, "utf8")).trim());
    deactivate();
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 6000 });
    expect(await pending).toBeInstanceOf(Error);
    expect(bridge.status(entry.id)).toEqual({ status: "stopped" });
  });

  it("offers additive nongraphical computer tools with validated workspace file and native shell operations", async () => {
    const { bridge, entry, endpoint, root } = await setup("computer");
    const connection = await client(endpoint, entry.token);
    expect((await connection.listTools()).tools.map((tool) => tool.name)).toEqual([
      "mac_shell",
      "mac_read_file",
      "mac_write_file",
      "mac_list_files",
      "mac_environment",
    ]);
    expect(await bridge.test(entry.id)).toEqual({ toolCount: 5 });
    expect(
      await connection.callTool({
        name: "mac_write_file",
        arguments: { path: "test.txt", content: "offline" },
      }),
    ).toEqual({ content: [{ type: "text", text: '{"written":true}' }] });
    expect(
      await connection.callTool({ name: "mac_read_file", arguments: { path: "test.txt" } }),
    ).toEqual({ content: [{ type: "text", text: '{"content":"offline"}' }] });
    const result = await connection.callTool({
      name: "mac_shell",
      arguments: { command: "printf fixture-output" },
    });
    expect(result).toEqual({
      content: [{ type: "text", text: '{"exitCode":0,"stdout":"fixture-output","stderr":""}' }],
    });
    expect(
      (await connection.callTool({ name: "mac_read_file", arguments: { path: "../../outside" } }))
        .isError,
    ).toBe(true);
    expect(
      (
        await connection.callTool({
          name: "mac_shell",
          arguments: { command: "echo bad", argv: [] },
        })
      ).isError,
    ).toBe(true);
    await connection.callTool({
      name: "mac_write_file",
      arguments: { path: path.join(root, "outside"), content: "bad" },
    });
    expect(await exists(path.join(root, "outside"))).toBe(false);
  });

  it("bounds concurrent work and closes every persistent upstream process", async () => {
    const { bridge, entry, endpoint, started, launches } = await setup();
    const connection = await client(endpoint, entry.token);
    const calls = Array.from({ length: 16 }, () =>
      connection
        .callTool({ name: "echo", arguments: { wait: true } })
        .catch((error: unknown) => error),
    );
    await vi.waitFor(async () => expect(await exists(started)).toBe(true));
    await vi.waitFor(async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${entry.token}` },
        body: "{}",
      });
      expect(response.status).toBe(429);
    });
    await expect(bridge.test(entry.id)).rejects.toThrow("Too many");
    const cancellation = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${entry.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: "unknown" },
      }),
    });
    expect(cancellation.status).toBe(202);
    const pid = Number((await readFile(launches, "utf8")).trim());
    await bridge.close();
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    await Promise.all(calls);
  });

  it("revokes running native shell work without leaving its process alive", async () => {
    const { bridge, entry, endpoint, root } = await setup("computer");
    const connection = await client(endpoint, entry.token);
    const workspace = path.join(
      root,
      "desktop-computers",
      createHash("sha256").update(entry.id).digest("hex"),
    );
    const pending = connection
      .callTool({ name: "mac_shell", arguments: { command: "echo $$ > command.pid; sleep 30" } })
      .catch((error: unknown) => error);
    await vi.waitFor(async () =>
      expect(await exists(path.join(workspace, "command.pid"))).toBe(true),
    );
    const pid = Number((await readFile(path.join(workspace, "command.pid"), "utf8")).trim());
    await bridge.setEnabled(entry.id, false);
    expect(await pending).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
  });

  it("routes SDK cancellation notifications across stateless HTTP requests", async () => {
    const { entry, endpoint, root } = await setup("computer");
    await client(endpoint, entry.token);
    const headers = {
      Authorization: `Bearer ${entry.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const workspace = path.join(
      root,
      "desktop-computers",
      createHash("sha256").update(entry.id).digest("hex"),
    );
    const pending = fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "cancel-me",
        method: "tools/call",
        params: { name: "mac_shell", arguments: { command: "echo $$ > command.pid; sleep 30" } },
      }),
    });
    await vi.waitFor(async () =>
      expect(await exists(path.join(workspace, "command.pid"))).toBe(true),
    );
    const pid = Number((await readFile(path.join(workspace, "command.pid"), "utf8")).trim());
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: "cancel-me" },
      }),
    });
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(alive(pid)).toBe(false));
    expect((await pending).status).toBe(200);
  });

  it("bounds authenticated request bodies before starting a command", async () => {
    const { endpoint, entry, launches } = await setup();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${entry.token}` },
      body: "x".repeat(1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(await exists(launches)).toBe(false);
  });
});
