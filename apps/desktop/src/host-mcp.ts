import { randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import type { HostMcpEntry } from "@rakazo/adapters/host-mcp-server";
import { startHostMcpServer } from "@rakazo/adapters/host-mcp-server";
import type { DesktopHostMcpServer } from "@rakazo/contracts";
import { DesktopHostMcpInputSchema } from "@rakazo/contracts";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

interface SavedEntry extends HostMcpEntry {
  serverId?: string;
  spaceId?: string;
}

interface StoredHostMcp {
  version: 1;
  port: number;
  entries: SavedEntry[];
}

const MAX_HOST_MCP_BYTES = 1024 * 1024;
const MAX_HOST_MCP_SERVERS = 32;

function parseSaved(raw: string | null): StoredHostMcp {
  if (raw === null) return { version: 1, port: 0, entries: [] };
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("port" in value) ||
    !Number.isInteger(value.port) ||
    typeof value.port !== "number" ||
    value.port < 0 ||
    value.port > 65535 ||
    !("entries" in value) ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_HOST_MCP_SERVERS
  ) {
    throw new Error("Saved local MCP configuration is invalid.");
  }
  const ids = new Set<string>();
  const entries: SavedEntry[] = value.entries.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(entry.id) ||
      ids.has(entry.id) ||
      !("token" in entry) ||
      typeof entry.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.token) ||
      !("enabled" in entry) ||
      typeof entry.enabled !== "boolean" ||
      !("input" in entry)
    ) {
      throw new Error("Saved local MCP registration is invalid.");
    }
    ids.add(entry.id);
    const input = DesktopHostMcpInputSchema.parse(entry.input);
    const serverId =
      "serverId" in entry && typeof entry.serverId === "string" ? entry.serverId : undefined;
    const spaceId =
      "spaceId" in entry && typeof entry.spaceId === "string" ? entry.spaceId : undefined;
    return { id: entry.id, token: entry.token, input, enabled: entry.enabled, serverId, spaceId };
  });
  return { version: 1, port: value.port, entries };
}

export async function prepareHostMcp(userDataDir: string) {
  await mkdir(userDataDir, { recursive: true });
  const configFile = path.join(userDataDir, "host-mcp.json");
  const raw = await readPrivateFile(configFile, MAX_HOST_MCP_BYTES);
  if (raw === null) {
    const existing = await lstat(configFile).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) throw new Error("Saved local MCP configuration could not be read safely.");
  }
  const saved = parseSaved(raw);
  let active = false;
  let entries = saved.entries;
  const bridge = await startHostMcpServer({
    root: path.join(userDataDir, "host-mcp-workspaces"),
    port: saved.port,
    entries,
    isActive: () => active,
  });
  let writes: Promise<void> = Promise.resolve();
  function persist() {
    const contents = JSON.stringify({ version: 1, port: bridge.port, entries });
    if (Buffer.byteLength(contents) > MAX_HOST_MCP_BYTES)
      throw new Error("Local MCP configuration is too large.");
    const write = writes.then(() => writePrivateFile(configFile, contents));
    writes = write.catch(() => undefined);
    return write;
  }
  try {
    await persist();
  } catch (error) {
    await bridge.close();
    throw error;
  }
  function find(id: string) {
    const entry = entries.find((entry) => entry.id === id);
    if (!entry) throw new Error("Local MCP server not found.");
    return entry;
  }
  function describe(entry: SavedEntry): DesktopHostMcpServer {
    const input = entry.input;
    const status = bridge.status(entry.id);
    return {
      id: entry.id,
      name: input.name,
      kind: input.kind,
      endpoint: `http://host.docker.internal:${bridge.port}/mcp/host/${input.kind}/${entry.id}`,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      envKeys: Object.keys(input.env ?? {}),
      serverId: entry.serverId,
      spaceId: entry.spaceId,
      enabled: entry.enabled,
      ...status,
    };
  }
  return {
    async activate(value: boolean) {
      active = value;
      await Promise.all(
        entries.map((entry) => bridge.setEnabled(entry.id, value && entry.enabled)),
      );
    },
    list: () => entries.map(describe),
    get: (id: string) => describe(find(id)),
    async add(value: unknown) {
      if (!active) throw new Error("Open the managed local instance before adding Mac tools.");
      if (entries.length >= MAX_HOST_MCP_SERVERS)
        throw new Error("Remove a local MCP server before adding another.");
      const input = DesktopHostMcpInputSchema.parse(value);
      const entry: SavedEntry = {
        id: randomUUID(),
        token: randomBytes(32).toString("hex"),
        input,
        enabled: true,
      };
      entries = [...entries, entry];
      try {
        await persist();
      } catch (error) {
        entries = entries.filter((item) => item !== entry);
        throw error;
      }
      try {
        bridge.add(entry);
      } catch (error) {
        entries = entries.filter((item) => item !== entry);
        await persist();
        throw error;
      }
      return { server: describe(entry), token: entry.token };
    },
    async attach(id: string, serverId: string, spaceId: string) {
      const entry = find(id);
      entry.serverId = serverId;
      entry.spaceId = spaceId;
      await persist();
    },
    async remove(id: string) {
      find(id);
      await bridge.remove(id);
      entries = entries.filter((entry) => entry.id !== id);
      await persist();
    },
    async setEnabled(id: string, enabled: boolean) {
      const entry = find(id);
      if (!enabled) await bridge.setEnabled(id, false);
      entry.enabled = enabled;
      try {
        await persist();
      } catch (error) {
        entry.enabled = false;
        await bridge.setEnabled(id, false);
        throw error;
      }
      if (enabled) await bridge.setEnabled(id, active && entry.enabled);
    },
    test: (id: string) => bridge.test(find(id).id),
    async revoke() {
      for (const entry of entries) entry.enabled = false;
      const stopped = await Promise.allSettled(
        entries.map((entry) => bridge.setEnabled(entry.id, false)),
      );
      await persist();
      if (stopped.some((result) => result.status === "rejected"))
        throw new Error(
          "Some local MCP processes could not be stopped. Quit Rakazo to stop local tools.",
        );
    },
    close: () => bridge.close(),
  };
}
