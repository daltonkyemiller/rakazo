import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, DesktopHostMcpServer, McpServer } from "@rakazo/contracts";
import { mcpServerLocation } from "@rakazo/core";
import { Badge, Button, cn, DialogTitle } from "@rakazo/ui-web";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { ConnectorIcon } from "../integrations/ConnectorIcon";
import { McpServerHealthLine } from "../McpServerHealthLine";
import { McpAgentAccess } from "./McpAgentAccess";
import { McpLocationIcon } from "./McpServerRow";
import { mcpHealth, mcpLocationLabel } from "./mcp-labels";

/** One line of the status panel: what is true now, and the action that changes it. */
function StatusRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

function KeyList({ keys }: { keys: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {keys.map((key) => (
        <Badge
          key={key}
          variant="secondary"
          className="h-5 px-1.5 font-mono text-[11px] font-normal"
        >
          {key}
        </Badge>
      ))}
    </span>
  );
}

export function McpServerDetail({
  server,
  local,
  bots,
  assignedBotIds,
  testing,
  oauthPending,
  confirmingRemove,
  removing,
  onToggleAgent,
  onTest,
  onConnectOAuth,
  onDisconnectOAuth,
  onRemove,
  onAllowLocal,
  onOpenPermissions,
}: {
  server: McpServer;
  local?: DesktopHostMcpServer;
  bots: Bot[];
  assignedBotIds: Set<string>;
  testing: boolean;
  oauthPending: boolean;
  confirmingRemove: boolean;
  removing: boolean;
  onToggleAgent: (botId: string) => void;
  onTest: () => void;
  onConnectOAuth: () => void;
  onDisconnectOAuth: () => void;
  onRemove: () => void;
  onAllowLocal: () => void;
  onOpenPermissions?: () => void;
}) {
  const { t } = useLingui();
  const health = mcpHealth(server);
  const location = mcpServerLocation(server);
  // Servers from releases before OAuth support omit its status; their saved credential still works.
  const oauthSupported = (server as Partial<McpServer>).oauthStatus !== undefined;
  const showOAuth =
    oauthSupported &&
    location.kind !== "mac" &&
    (server.transport !== "stdio" || Boolean(server.oauthClientId));
  const oauthStatus =
    server.oauthStatus === "connected"
      ? t`OAuth connected`
      : server.oauthStatus === "reconnect"
        ? t`OAuth expired`
        : server.hasSecret
          ? t`Credential saved`
          : t`OAuth not connected`;
  const localPaused = local?.enabled === false;
  const localError = local?.status === "error" && local.error ? local.error : null;
  const hasStatus = Boolean(health || showOAuth || localPaused || localError);

  const command = location.kind === "mac" ? local?.command : (server.command ?? undefined);
  const args = location.kind === "mac" ? (local?.args ?? []) : server.args;
  const envKeys = location.kind === "mac" ? (local?.envKeys ?? []) : server.envKeys;
  const details: [string, ReactNode][] = [];
  if (location.kind === "remote" && server.endpoint) details.push([t`URL`, server.endpoint]);
  if (command) details.push([t`Command`, [command, ...args].join(" ")]);
  if (local?.cwd) details.push([t`Working directory`, local.cwd]);
  if (envKeys?.length)
    details.push([t`Environment variables`, <KeyList key="env" keys={envKeys} />]);
  if (server.headerKeys?.length)
    details.push([t`Headers`, <KeyList key="headers" keys={server.headerKeys} />]);
  if (server.fileKeys?.length) {
    details.push([t`Credential files`, <KeyList key="files" keys={server.fileKeys} />]);
  }
  if (location.kind === "remote" && server.transport === "sse") details.push([t`Transport`, "SSE"]);

  return (
    <div data-testid="mcp-server-detail" className="space-y-8">
      <header className="flex items-center gap-3">
        <ConnectorIcon name={server.name} className="size-11 rounded-xl text-base" />
        <div className="min-w-0">
          <DialogTitle className="truncate text-lg font-medium text-foreground" dir="auto">
            {server.name}
          </DialogTitle>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <McpLocationIcon location={location.kind} />
            <span className="truncate">{mcpLocationLabel(server, local, "sentence")}</span>
          </p>
        </div>
      </header>

      {hasStatus ? (
        <section
          aria-label={t`Status`}
          className="divide-y divide-border overflow-hidden rounded-xl border border-border"
        >
          {localPaused ? (
            <StatusRow
              action={
                <Button type="button" size="sm" onClick={onAllowLocal}>
                  <Trans>Allow on this Mac</Trans>
                </Button>
              }
            >
              <p className="text-sm text-foreground">
                <Trans>Paused on this Mac</Trans>
              </p>
            </StatusRow>
          ) : null}
          {localError ? (
            <StatusRow>
              <p role="alert" className="text-sm text-destructive wrap-anywhere">
                {localError}
              </p>
            </StatusRow>
          ) : null}
          {health ? (
            <StatusRow
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testing || health.status === "installing"}
                  onClick={onTest}
                >
                  {testing ? (
                    <>
                      <LoaderCircle aria-hidden="true" className="animate-spin" />
                      <Trans>Testing…</Trans>
                    </>
                  ) : (
                    <Trans>Test connection</Trans>
                  )}
                </Button>
              }
            >
              <McpServerHealthLine health={health} checking={testing} />
            </StatusRow>
          ) : null}
          {showOAuth ? (
            <StatusRow
              action={
                <>
                  {server.oauthStatus !== "none" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      disabled={oauthPending}
                      onClick={onDisconnectOAuth}
                    >
                      <Trans>Disconnect</Trans>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant={server.oauthStatus === "reconnect" ? "default" : "outline"}
                    disabled={oauthPending}
                    onClick={onConnectOAuth}
                  >
                    {oauthPending ? (
                      <Trans>Connecting…</Trans>
                    ) : server.oauthStatus === "none" ? (
                      <Trans>Connect OAuth</Trans>
                    ) : (
                      <Trans>Reconnect OAuth</Trans>
                    )}
                  </Button>
                </>
              }
            >
              <p
                className={cn(
                  "text-xs font-medium",
                  server.oauthStatus === "reconnect" ? "text-warning" : "text-muted-foreground",
                )}
              >
                {oauthStatus}
              </p>
            </StatusRow>
          ) : null}
        </section>
      ) : null}

      <McpAgentAccess
        bots={bots}
        isAssigned={(botId) => assignedBotIds.has(botId)}
        onChange={(botId) => onToggleAgent(botId)}
      />

      {details.length > 0 ? (
        <section aria-labelledby="mcp-server-configuration">
          <h3
            id="mcp-server-configuration"
            className="mb-2 text-[13px] font-medium text-muted-foreground"
          >
            <Trans>Configuration</Trans>
          </h3>
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2.5 text-xs">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd
                  dir="ltr"
                  className="min-w-0 text-start font-mono text-foreground wrap-anywhere"
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {onOpenPermissions ? (
        <section className="flex items-start justify-between gap-4 rounded-xl border border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm text-foreground">
              <Trans>Mac permissions</Trans>
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <Trans>
                Approve access in the macOS prompt. Some permissions require System Settings.
              </Trans>
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onOpenPermissions}>
            <Trans>Open settings</Trans>
          </Button>
        </section>
      ) : null}

      <div className="border-t border-border pt-5">
        <Button
          type="button"
          variant={confirmingRemove ? "destructive" : "ghost"}
          size="sm"
          className={cn(!confirmingRemove && "-ms-2 text-destructive hover:text-destructive")}
          disabled={removing}
          onClick={onRemove}
        >
          {removing ? (
            <Trans>Removing…</Trans>
          ) : confirmingRemove ? (
            <Trans>Confirm remove</Trans>
          ) : (
            <Trans>Remove</Trans>
          )}
        </Button>
      </div>
    </div>
  );
}
