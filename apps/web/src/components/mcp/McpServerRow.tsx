import type { DesktopHostMcpServer, McpServer } from "@rakazo/contracts";
import type { McpServerLocation } from "@rakazo/core";
import { mcpServerLocation } from "@rakazo/core";
import { cn } from "@rakazo/ui-web";
import { ChevronRight, Globe, Laptop, Server } from "lucide-react";
import type { MouseEvent } from "react";
import { ConnectorIcon } from "../integrations/ConnectorIcon";
import { mcpLocationLabel, mcpStatusLabel, mcpStatusTone } from "./mcp-labels";

/** Where a server runs, as a glyph beside its label: a remote host, Rakazo's server, or a Mac. */
export function McpLocationIcon({
  location,
  className,
}: {
  location: McpServerLocation["kind"];
  className?: string;
}) {
  const Icon = location === "mac" ? Laptop : location === "server" ? Server : Globe;
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", className)} />;
}

/** One registered server: name and where it runs, with its status only when there is one. */
export function McpServerRow({
  server,
  local,
  testId,
  rowKey,
  onOpen,
}: {
  server: McpServer;
  local?: DesktopHostMcpServer;
  testId: string;
  rowKey: string;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const location = mcpServerLocation(server).kind;
  const status = mcpStatusLabel(server, local);
  const tone = mcpStatusTone(server, local);
  return (
    <button
      type="button"
      data-testid={testId}
      data-mcp-key={rowKey}
      data-location={location}
      className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-start outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
    >
      <ConnectorIcon name={server.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground" dir="auto">
          {server.name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <McpLocationIcon location={location} />
          <span className="truncate">{mcpLocationLabel(server, local, "short")}</span>
        </span>
      </span>
      {status ? (
        <span className={cn("flex shrink-0 items-center gap-1.5 text-xs", tone.text)}>
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", tone.dot)} />
          {status}
        </span>
      ) : null}
      <ChevronRight
        size={16}
        className="shrink-0 text-muted-foreground/70 rtl:rotate-180"
        aria-hidden="true"
      />
    </button>
  );
}
