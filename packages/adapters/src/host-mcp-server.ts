import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
  CallToolResult,
  ListToolsResult,
  RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  CancelledNotificationSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import type { DesktopHostMcpInput } from "@rakazo/contracts";
import { z } from "zod";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { McpSession } from "./mcp-transport.js";
import { nativeShellCommandArgv } from "./native-shell.js";
import { hostCommandEnvironment } from "./sandbox-command-environment.js";

export interface HostMcpEntry {
  id: string;
  token: string;
  input: DesktopHostMcpInput;
  enabled: boolean;
}

export interface HostMcpStatus {
  status: "stopped" | "ready" | "error";
  error?: string;
}

const MAX_BYTES = 1024 * 1024;
const MAX_ACTIVE = 16;
const CONTROL_SLOTS = 4;
const DEADLINE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pathArguments = z.object({ path: z.string().max(4096) }).strict();
const writeArguments = pathArguments.extend({ content: z.string().max(MAX_BYTES) });
const shellArguments = z
  .object({
    command: z
      .string()
      .min(1)
      .max(64 * 1024),
    cwd: z.string().max(4096).optional(),
  })
  .strict();
const emptyArguments = z.object({}).strict();
const computerSchemas = {
  mac_shell: shellArguments,
  mac_read_file: pathArguments,
  mac_write_file: writeArguments,
  mac_list_files: pathArguments,
  mac_environment: emptyArguments,
};

function textResult(value: unknown): CallToolResult {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Local MCP result exceeds size limit");
  return { content: [{ type: "text", text }] };
}

interface EntryState {
  entry: HostMcpEntry;
  lifecycle: AbortController;
  status: HostMcpStatus;
  session?: McpSession;
  starting?: Promise<McpSession>;
  provider: DesktopSandboxProvider;
  computer?: Promise<ComputerRef>;
  revoking?: Promise<void>;
  calls: Map<RequestId, AbortController>;
}

export async function startHostMcpServer(options: {
  port?: number;
  hostname?: string;
  root: string;
  entries: HostMcpEntry[];
  isActive: () => boolean;
}) {
  const entries = new Map<string, EntryState>();
  const active = new Set<AbortController>();
  let closed = false;

  function assertActive(state: EntryState, signal?: AbortSignal) {
    signal?.throwIfAborted();
    state.lifecycle.signal.throwIfAborted();
    if (closed || !options.isActive() || !state.entry.enabled)
      throw new Error("Local MCP access is disabled");
  }

  function diagnostic(state: EntryState, error: unknown): string {
    // Upstream stderr and arbitrary error messages may contain credentials, paths, or tool input.
    // Only expose a small actionable classification, never upstream text.
    const missing = error instanceof Error && /ENOENT|not found/.test(error.message);
    const message = missing
      ? "Command not found. Check the executable and configured PATH, then test again."
      : "Local MCP connection failed. Check the approved command and environment, then test again.";
    return Object.values(state.entry.input.env ?? {}).reduce(
      (text, secret) => (secret ? text.split(secret).join("[redacted]") : text),
      message,
    );
  }

  function add(entry: HostMcpEntry) {
    if (closed) throw new Error("Local MCP bridge is closed");
    if (!UUID.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.token))
      throw new Error("Invalid local MCP identity or credential");
    if (
      entries.has(entry.id) ||
      [...entries.values()].some((state) => state.entry.token === entry.token)
    )
      throw new Error("Local MCP identity and credential must be unique");
    if (entry.input.kind !== "command" && entry.input.kind !== "computer")
      throw new Error("Invalid local MCP kind");
    if (
      entry.input.kind === "command" &&
      (!entry.input.command?.trim() || entry.input.command.includes("\0"))
    )
      throw new Error("An approved executable is required");
    entries.set(entry.id, {
      entry: structuredClone(entry),
      lifecycle: new AbortController(),
      calls: new Map(),
      status: { status: "stopped" },
      provider: new DesktopSandboxProvider({
        root: options.root,
        hostRoots: [homedir()],
        maxFileBytes: MAX_BYTES,
      }),
    });
  }

  async function commandSession(state: EntryState): Promise<McpSession> {
    assertActive(state);
    if (state.revoking) {
      await state.revoking;
      assertActive(state);
    }
    if (state.starting) return state.starting;
    if (state.session) return state.session;
    const session = new McpSession();
    const lifecycle = state.lifecycle;
    state.session = session;
    session.client.onclose = () => {
      if (state.session !== session || lifecycle.signal.aborted) return;
      state.session = undefined;
      state.status = { status: "error", error: diagnostic(state, undefined) };
    };
    state.starting = (async () => {
      try {
        const input = state.entry.input;
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(hostCommandEnvironment({ env: input.env }))) {
          if (value !== undefined) env[key] = value;
        }
        if (process.platform === "darwin" && input.env?.PATH === undefined) {
          env.PATH = [
            ...new Set([
              ...(env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(":"),
              "/opt/homebrew/bin",
              "/usr/local/bin",
              `${homedir()}/.local/bin`,
            ]),
          ].join(":");
        }
        await session.connectStdio({
          command: input.command ?? "",
          args: input.args,
          cwd: input.cwd,
          env,
          allowedCommands: [input.command ?? ""],
          signal: lifecycle.signal,
          timeoutMs: 15_000,
          maxBufferSize: MAX_BYTES,
        });
        lifecycle.signal.throwIfAborted();
        assertActive(state);
        state.status = { status: "ready" };
        return session;
      } catch (error) {
        await session.close();
        if (state.session === session) state.session = undefined;
        if (!lifecycle.signal.aborted)
          state.status = { status: "error", error: diagnostic(state, error) };
        throw new Error(diagnostic(state, error));
      } finally {
        state.starting = undefined;
      }
    })();
    return state.starting;
  }

  function context(state: EntryState, signal: AbortSignal): AdapterContext {
    return {
      operationId: state.entry.id,
      traceId: state.entry.id,
      spaceId: "local",
      userId: "local",
      signal,
    };
  }

  async function listTools(state: EntryState, signal: AbortSignal): Promise<ListToolsResult> {
    assertActive(state, signal);
    if (state.entry.input.kind === "command") {
      const session = await commandSession(state);
      assertActive(state, signal);
      try {
        const result = await session.listTools({ signal });
        assertActive(state, signal);
        if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES)
          throw new Error("Result too large");
        return result;
      } catch (error) {
        throw new Error(diagnostic(state, error));
      }
    }
    state.status = { status: "ready" };
    return {
      tools: Object.entries(computerSchemas).map(([name, schema]) =>
        ToolSchema.parse({
          name,
          inputSchema: z.toJSONSchema(schema),
        }),
      ),
    };
  }

  async function callTool(
    state: EntryState,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    assertActive(state, signal);
    if (state.entry.input.kind === "command") {
      const session = await commandSession(state);
      assertActive(state, signal);
      return session.callTool(name, args, { signal });
    }
    const provider = state.provider;
    state.computer ??= provider
      .provision(
        {
          botId: createHash("sha256").update(state.entry.id).digest("hex"),
          homePath: "",
        },
        context(state, signal),
      )
      .catch((error: unknown) => {
        state.computer = undefined;
        throw error;
      });
    const computer = await state.computer;
    assertActive(state, signal);
    const adapterContext = context(state, signal);
    switch (name) {
      case "mac_environment":
        emptyArguments.parse(args);
        return textResult(await provider.environment());
      case "mac_read_file":
        return textResult({
          content: Buffer.from(
            await provider.readFile(computer, pathArguments.parse(args).path, adapterContext, {
              maxBytes: MAX_BYTES,
            }),
          ).toString("utf8"),
        });
      case "mac_write_file": {
        const input = writeArguments.parse(args);
        await provider.writeFile(computer, {
          path: input.path,
          content: Buffer.from(input.content),
        });
        return textResult({ written: true });
      }
      case "mac_list_files":
        return textResult(
          await provider.listFiles(computer, pathArguments.parse(args).path, adapterContext),
        );
      case "mac_shell": {
        const input = shellArguments.parse(args);
        const controller = new AbortController();
        const commandSignal = AbortSignal.any([signal, controller.signal]);
        let stdout = "";
        let stderr = "";
        let exitCode = 1;
        for await (const event of provider.execute(
          computer,
          {
            argv: nativeShellCommandArgv(input.command, await provider.environment()),
            cwd: input.cwd,
            env: state.entry.input.env,
            timeoutMs: DEADLINE_MS,
          },
          context(state, commandSignal),
        )) {
          if (event.type === "stdout") stdout += event.data;
          if (event.type === "stderr") stderr += event.data;
          if (event.type === "exit") exitCode = event.code;
          if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_BYTES / 2) {
            controller.abort();
            throw new Error("Local MCP result exceeds size limit");
          }
        }
        return textResult({ exitCode, stdout, stderr });
      }
      default:
        throw new Error("Unknown local MCP tool");
    }
  }

  function revoke(state: EntryState): Promise<void> {
    if (state.revoking) return state.revoking;
    state.lifecycle.abort();
    state.provider.cancelAllCommands();
    const starting = state.starting;
    const session = state.session;
    state.status = { status: "stopped" };
    state.revoking = (async () => {
      await session?.close();
      await starting?.catch(() => undefined);
      // Startup can finish after the first close while a transport is still spawning.
      await session?.close();
      state.session = undefined;
      state.starting = undefined;
      state.revoking = undefined;
      if (!closed) state.lifecycle = new AbortController();
    })();
    return state.revoking;
  }

  for (const entry of options.entries) add(entry);
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const match = /^\/mcp\/host\/(command|computer)\/([0-9a-f-]+)$/.exec(request.url ?? "");
    const state = match && UUID.test(match[2] ?? "") ? entries.get(match[2] ?? "") : undefined;
    if (!state || state.entry.input.kind !== match?.[1]) {
      response.writeHead(404).end();
      return;
    }
    const credential = createHash("sha256")
      .update(request.headers.authorization ?? "")
      .digest();
    const expected = createHash("sha256").update(`Bearer ${state.entry.token}`).digest();
    if (
      request.headers.origin !== undefined ||
      request.headers["sec-fetch-site"] !== undefined ||
      !timingSafeEqual(credential, expected)
    ) {
      response.writeHead(401).end();
      return;
    }
    if (closed || !options.isActive() || !state.entry.enabled || state.lifecycle.signal.aborted) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    if (active.size >= MAX_ACTIVE + CONTROL_SLOTS) {
      response.writeHead(429).end();
      return;
    }
    const controller = new AbortController();
    active.add(controller);
    const signal = AbortSignal.any([
      controller.signal,
      state.lifecycle.signal,
      AbortSignal.timeout(DEADLINE_MS),
    ]);
    const protocol = new Server(
      { name: "rakazo-host", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const cleanup = () => controller.abort();
    const aborted = () => {
      response.destroy();
    };
    response.once("close", cleanup);
    signal.addEventListener("abort", aborted, { once: true });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BYTES) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assertActive(state, signal);
      const cancellation = CancelledNotificationSchema.safeParse(body);
      if (cancellation.success) {
        const id = cancellation.data.params.requestId;
        if (id !== undefined) state.calls.get(id)?.abort();
      } else if (active.size > MAX_ACTIVE) {
        response.writeHead(429).end();
        return;
      }
      async function requestWork<T>(
        id: RequestId,
        sdkSignal: AbortSignal,
        operation: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        if (!state) throw new Error("Local MCP entry not found");
        if (state.calls.has(id)) throw new Error("Duplicate local MCP request");
        const cancellation = new AbortController();
        state.calls.set(id, cancellation);
        try {
          return await operation(AbortSignal.any([signal, sdkSignal, cancellation.signal]));
        } finally {
          state.calls.delete(id);
        }
      }
      protocol.setRequestHandler(ListToolsRequestSchema, async (_request, extra) =>
        requestWork(extra.requestId, extra.signal, (callSignal) => listTools(state, callSignal)),
      );
      protocol.setRequestHandler(CallToolRequestSchema, async (toolRequest, extra) => {
        try {
          const result = await requestWork(extra.requestId, extra.signal, (callSignal) =>
            callTool(
              state,
              toolRequest.params.name,
              toolRequest.params.arguments ?? {},
              callSignal,
            ),
          );
          assertActive(state, signal);
          if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES)
            throw new Error("Result too large");
          return result;
        } catch {
          return {
            content: [
              {
                type: "text",
                text: "Local MCP tool failed. Check the connection and tool arguments.",
              },
            ],
            isError: true,
          };
        }
      });
      await protocol.connect(transport);
      await transport.handleRequest(request, response, body);
      if (!response.writableFinished && !response.destroyed)
        await new Promise<void>((resolve) => response.once("close", resolve));
    } catch {
      if (!response.headersSent) response.writeHead(400);
      if (!response.destroyed) response.end();
    } finally {
      signal.removeEventListener("abort", aborted);
      response.removeListener("close", cleanup);
      controller.abort();
      active.delete(controller);
      await protocol.close();
    }
  });
  server.requestTimeout = DEADLINE_MS;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  server.maxConnections = 64;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.hostname ?? "0.0.0.0", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  // isActive is a callback rather than an event source; also revoke idle cached processes.
  const activity = setInterval(() => {
    if (!options.isActive()) {
      for (const state of entries.values()) {
        if (state.session || state.computer) void revoke(state);
      }
      for (const controller of active) controller.abort();
    }
  }, 100);
  activity.unref();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local MCP listener unavailable");
  function required(id: string) {
    const state = entries.get(id);
    if (!state) throw new Error("Local MCP entry not found");
    return state;
  }
  return {
    port: address.port,
    add,
    async remove(id: string) {
      const state = required(id);
      state.entry.enabled = false;
      entries.delete(id);
      await revoke(state);
    },
    async setEnabled(id: string, enabled: boolean) {
      const state = required(id);
      state.entry.enabled = enabled;
      await revoke(state);
    },
    status(id: string): HostMcpStatus {
      const state = required(id);
      if (!options.isActive() || !state.entry.enabled) return { status: "stopped" };
      return { ...state.status };
    },
    async test(id: string): Promise<{ toolCount: number }> {
      const state = required(id);
      if (active.size >= MAX_ACTIVE) throw new Error("Too many local MCP requests");
      const controller = new AbortController();
      active.add(controller);
      try {
        const signal = AbortSignal.any([
          controller.signal,
          state.lifecycle.signal,
          AbortSignal.timeout(DEADLINE_MS),
        ]);
        return { toolCount: (await listTools(state, signal)).tools.length };
      } finally {
        active.delete(controller);
      }
    },
    async close() {
      closed = true;
      clearInterval(activity);
      for (const controller of active) controller.abort();
      await Promise.all([...entries.values()].map(revoke));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
