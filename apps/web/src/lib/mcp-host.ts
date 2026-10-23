import type {
  DesktopHostMcpInput,
  DesktopHostMcpServer,
  McpServer,
  RakazoDesktop,
} from "@rakazo/contracts";
import { useCallback, useEffect, useState } from "react";
import { desktopBridge } from "./desktop";

export type HostMcpBridge = NonNullable<RakazoDesktop["mcp"]>;

export type HostMcpState = {
  bridge?: HostMcpBridge;
  servers: DesktopHostMcpServer[];
  refresh: () => Promise<void>;
};

/** The registration on this Mac could not be undone after the backend step failed. */
export class HostMcpCleanupError extends Error {
  constructor(readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = "HostMcpCleanupError";
  }
}

/**
 * Commands that run on this Mac, when the desktop app can host them. Older desktop releases
 * and every other client have no bridge, so `bridge` stays undefined there.
 */
export function useHostMcp(): HostMcpState {
  const [state, setState] = useState<{ bridge?: HostMcpBridge; servers: DesktopHostMcpServer[] }>({
    servers: [],
  });
  const refresh = useCallback(async () => {
    const bridge = desktopBridge()?.mcp;
    if (!bridge) return;
    try {
      const next = await bridge.state();
      setState({ bridge: next.available ? bridge : undefined, servers: next.servers });
    } catch {
      setState({ servers: [] });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { ...state, refresh };
}

/**
 * Start a command on this Mac and register its scoped endpoint with Rakazo. The desktop app
 * asks for consent first (`declined` when refused). If the backend step fails, the local
 * registration is removed so nothing keeps running that Rakazo does not know about.
 */
export async function addHostMcpServer(
  bridge: HostMcpBridge,
  input: DesktopHostMcpInput,
  backend: {
    create: (endpoint: string, token: string) => Promise<McpServer>;
    remove: (id: string) => Promise<unknown>;
  },
): Promise<{ status: "declined" } | { status: "added"; server: McpServer }> {
  const registration = await bridge.add(input);
  if (!registration) return { status: "declined" };
  let created: McpServer | null = null;
  try {
    created = await backend.create(registration.server.endpoint, registration.token);
    await bridge.attach(registration.server.id, created.id, created.spaceId);
    return { status: "added", server: created };
  } catch (error) {
    const cleanup = await Promise.allSettled([
      bridge.remove(registration.server.id),
      ...(created ? [backend.remove(created.id)] : []),
    ]);
    if (cleanup.some((result) => result.status === "rejected")) {
      throw new HostMcpCleanupError(error);
    }
    throw error;
  }
}
