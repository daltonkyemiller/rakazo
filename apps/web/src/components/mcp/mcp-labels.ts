import { plural, t } from "@lingui/core/macro";
import type { DesktopHostMcpServer, McpServer, McpServerHealth } from "@rakazo/contracts";
import { mcpServerLocation } from "@rakazo/core";

/**
 * Servers from releases before health reporting omit it, so read it defensively and never
 * poll or test for it on their behalf.
 */
export function mcpHealth(server: McpServer): McpServerHealth | null {
  return (server as Partial<McpServer>).health ?? null;
}

/** Where a server's process runs, in a row's short form or the detail page's sentence. */
export function mcpLocationLabel(
  server: McpServer,
  local: DesktopHostMcpServer | undefined,
  form: "short" | "sentence",
): string {
  const location = mcpServerLocation(server);
  if (location.kind === "server") {
    return form === "short" ? t`Rakazo server` : t`Runs on Rakazo server`;
  }
  if (location.kind === "mac") {
    if (local) return form === "short" ? t`This Mac` : t`Runs on this Mac`;
    return form === "short" ? t`Your Mac` : t`Runs on your Mac`;
  }
  return form === "short" ? location.host : t`Runs on ${location.host}`;
}

/** The one status worth showing in a row; nothing when the server has not been checked. */
export function mcpStatusLabel(server: McpServer, local?: DesktopHostMcpServer): string | null {
  if (!server.enabled || local?.enabled === false) return t`Disabled`;
  if (server.oauthStatus === "reconnect") return t`OAuth expired`;
  if (local?.status === "error") return t`Not working`;
  const health = mcpHealth(server);
  if (health?.status === "error") return t`Not working`;
  if (health?.status === "installing") return t`Installing…`;
  if (health?.status === "ok") {
    return health.toolCount === null
      ? t`Running`
      : plural(health.toolCount, { one: "# tool", other: "# tools" });
  }
  return null;
}

export function mcpStatusTone(server: McpServer, local?: DesktopHostMcpServer) {
  if (server.oauthStatus === "reconnect") return "text-warning";
  if (local?.status === "error" || mcpHealth(server)?.status === "error") {
    return "text-destructive";
  }
  return "text-muted-foreground";
}
