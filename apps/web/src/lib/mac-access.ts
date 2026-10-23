import {
  deriveMcpSlug,
  grantMacAccess,
  MAC_COMPUTER_MCP_NAME,
  macComputerServers,
  revokeMacAccess,
  uniqueMcpSlug,
} from "@rakazo/core";
import type { HostMcpBridge } from "./mcp-host";
import { addHostMcpServer } from "./mcp-host";
import { rpc } from "./rpc";

const OPEN_EVENT = "rakazo:open-computer-access";
const CHANGED_EVENT = "rakazo:computer-access-changed";

/**
 * Registers this Mac's computer server with the desktop app (which asks for consent natively),
 * then with the backend. Returns null when the person declines.
 */
export async function registerMacComputer(bridge: HostMcpBridge) {
  const taken = (await rpc.mcp.servers.list()).map((existing) => existing.slug);
  const result = await addHostMcpServer(
    bridge,
    { kind: "computer", name: MAC_COMPUTER_MCP_NAME },
    {
      create: (endpoint, token) =>
        rpc.mcp.servers.create({
          slug: uniqueMcpSlug(deriveMcpSlug(MAC_COMPUTER_MCP_NAME), taken),
          name: MAC_COMPUTER_MCP_NAME,
          description: "",
          transport: "streamable_http",
          endpoint,
          headers: {},
          secret: token,
          enabled: true,
        }),
      remove: (id) => rpc.mcp.servers.remove({ id }),
    },
  );
  return result.status === "added" ? result.server : null;
}

/** The Mac server this desktop app hosts, registering one (with native consent) when missing. */
export async function ensureMacComputer(bridge: HostMcpBridge) {
  const [native, servers] = await Promise.all([bridge.state(), rpc.mcp.servers.list()]);
  const existing = macComputerServers(servers).find((server) =>
    native.servers.some((local) => local.kind === "computer" && local.serverId === server.id),
  );
  if (!existing) return registerMacComputer(bridge);
  const local = native.servers.find((entry) => entry.serverId === existing.id)!;
  if (!local.enabled) {
    await bridge.setEnabled(local.id, true);
    const current = await bridge.state();
    if (!current.servers.find((entry) => entry.id === local.id)?.enabled) return null;
  }
  if (!existing.enabled)
    return rpc.mcp.servers.update({
      id: existing.id,
      config: {
        slug: existing.slug,
        name: existing.name,
        description: existing.description,
        transport: "streamable_http",
        endpoint: existing.endpoint!,
        headers: {},
        enabled: true,
      },
    });
  return existing;
}

export async function setBotMacAccess(botId: string, serverId: string | null) {
  const [assignments, servers] = await Promise.all([
    rpc.mcp.assignments.list({ botId }),
    rpc.mcp.servers.list(),
  ]);
  const next =
    serverId === null
      ? revokeMacAccess(
          assignments,
          macComputerServers(servers).map((server) => server.id),
        )
      : grantMacAccess(assignments, serverId);
  await rpc.mcp.assignments.replace({ botId, assignments: next });
}

export function openComputerAccess() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onOpenComputerAccess(listener: () => void) {
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

export function notifyComputerAccessChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function onComputerAccessChanged(listener: () => void) {
  window.addEventListener(CHANGED_EVENT, listener);
  return () => window.removeEventListener(CHANGED_EVENT, listener);
}
