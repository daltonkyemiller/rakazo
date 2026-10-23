import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, DesktopHostMcpServer, McpServer } from "@rakazo/contracts";
import { mcpServerLocation } from "@rakazo/core";
import {
  Button,
  DialogTitle,
  Disclosure,
  FieldLegend,
  FieldSet,
  SwitchField,
} from "@rakazo/ui-web";
import { LoaderCircle } from "lucide-react";
import { ConnectorIcon } from "../integrations/ConnectorIcon";
import { McpServerHealthLine } from "../McpServerHealthLine";
import { mcpHealth, mcpLocationLabel } from "./mcp-labels";

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
          : null;
  const command = location.kind === "mac" ? local?.command : (server.command ?? undefined);
  const args = location.kind === "mac" ? (local?.args ?? []) : server.args;
  const envKeys = location.kind === "mac" ? (local?.envKeys ?? []) : server.envKeys;
  const details = [
    location.kind === "remote" && server.endpoint ? [t`URL`, server.endpoint] : null,
    command ? [t`Command`, [command, ...args].join(" ")] : null,
    local?.cwd ? [t`Working directory`, local.cwd] : null,
    envKeys?.length ? [t`Environment variables`, envKeys.join(", ")] : null,
    server.headerKeys?.length ? [t`Headers`, server.headerKeys.join(", ")] : null,
    server.fileKeys?.length ? [t`Credential files`, server.fileKeys.join(", ")] : null,
  ].filter((entry): entry is [string, string] => entry !== null);

  return (
    <div data-testid="mcp-server-detail" className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ConnectorIcon name={server.name} />
          <div className="min-w-0">
            <DialogTitle className="truncate text-lg font-medium text-foreground" dir="auto">
              {server.name}
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              {mcpLocationLabel(server, local, "sentence")}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant={confirmingRemove ? "destructive" : "secondary"}
          className="rounded-full"
          size="sm"
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

      {local?.enabled === false ? (
        <Button variant="outline" onClick={onAllowLocal}>
          <Trans>Allow on this Mac</Trans>
        </Button>
      ) : null}

      {local?.status === "error" && local.error ? (
        <p role="alert" className="text-sm text-destructive">
          {local.error}
        </p>
      ) : null}

      {health ? (
        <div className="flex items-start justify-between gap-3">
          <McpServerHealthLine health={health} checking={testing} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
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
        </div>
      ) : null}

      {showOAuth ? (
        <div className="flex flex-wrap items-center gap-2">
          {oauthStatus ? (
            <span
              className={`me-auto text-sm ${server.oauthStatus === "reconnect" ? "text-warning" : "text-muted-foreground"}`}
            >
              {oauthStatus}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
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
          {server.oauthStatus !== "none" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={oauthPending}
              onClick={onDisconnectOAuth}
            >
              <Trans>Disconnect</Trans>
            </Button>
          ) : null}
        </div>
      ) : null}

      {bots.length > 0 ? (
        <FieldSet className="gap-3" data-testid="mcp-server-agents">
          <FieldLegend variant="label">
            <Trans>Agents</Trans>
          </FieldLegend>
          {bots.map((bot) => (
            <SwitchField
              key={bot.id}
              label={bot.name}
              checked={assignedBotIds.has(bot.id)}
              onCheckedChange={() => onToggleAgent(bot.id)}
            />
          ))}
        </FieldSet>
      ) : null}

      {details.length > 0 ? (
        <Disclosure
          summary={<Trans>Details</Trans>}
          summaryClassName="text-sm text-muted-foreground"
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 pt-3 text-xs">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd dir="ltr" className="min-w-0 font-mono text-foreground wrap-anywhere">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      ) : null}
    </div>
  );
}
