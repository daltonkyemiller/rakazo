import type { McpServer } from "@rakazo/contracts";
import { mcpServerLocation } from "@rakazo/core";

type Translate = (message: string, values?: Record<string, string | number>) => string;

/** Where a registered server's process runs, in a row's short form. */
export function mcpLocationText(server: McpServer, t: Translate): string {
  const location = mcpServerLocation(server);
  if (location.kind === "server") return t("Rakazo server");
  if (location.kind === "mac") return t("Your Mac");
  return location.host;
}

/**
 * The one status worth showing, or null before anything has checked the server. Releases
 * before health reporting omit it, so nothing here assumes it exists.
 */
export function mcpStatusText(server: McpServer, t: Translate): string | null {
  const health = (server as Partial<McpServer>).health;
  if (!server.enabled) return t("Disabled");
  if (server.oauthStatus === "reconnect") return t("OAuth expired");
  if (health?.status === "error") return t("Not working");
  if (health?.status === "installing") return t("Installing…");
  if (health?.status !== "ok") return null;
  if (health.toolCount === null) return t("Running");
  return t(health.toolCount === 1 ? "{count} tool" : "{count} tools", {
    count: health.toolCount,
  });
}

/** Where a registered server runs and, when known, whether it works. */
export function mcpServerSummary(server: McpServer, t: Translate): string {
  const status = mcpStatusText(server, t);
  const where = mcpLocationText(server, t);
  return status ? `${where} · ${status}` : where;
}
