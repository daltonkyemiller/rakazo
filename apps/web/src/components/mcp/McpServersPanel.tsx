import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, BotMcpServer, IntegrationCatalogSurface, McpServer } from "@rakazo/contracts";
import { isRetryableError, mcpServerLocation } from "@rakazo/core";
import { Button, DialogHeader, DialogTitle, Spinner, toast } from "@rakazo/ui-web";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useEffect, useState } from "react";
import { connectMcpOauth, MCP_OAUTH_CHANNEL } from "../../lib/mcp-connect";
import type { HostMcpState } from "../../lib/mcp-host";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { ConnectorIcon } from "../integrations/ConnectorIcon";
import { McpServerAdd } from "./McpServerAdd";
import { McpServerDetail } from "./McpServerDetail";
import { mcpHealth, mcpLocationLabel, mcpStatusLabel, mcpStatusTone } from "./mcp-labels";

/** How often the list is re-read while a server installs its package or is being tested. */
const INSTALL_POLL_MS = 2500;

export type McpRoute =
  | { view: "list" }
  | { view: "add"; source?: string; name?: string; auth?: IntegrationCatalogSurface["auth"] }
  | { view: "detail"; serverId: string };

/**
 * MCP servers inside the Connect apps dialog: a flat list, a paste-first add page, and a
 * detail page, all reached by back navigation instead of nested dialogs.
 */
export function McpServersPanel({
  route,
  host,
  backLabel,
  backAriaLabel,
  backRef,
  closeButton,
  onNavigate,
  onReplace,
  onBack,
  onServersChange,
}: {
  route: McpRoute;
  host: HostMcpState;
  backLabel: string;
  backAriaLabel: string;
  backRef?: Ref<HTMLButtonElement>;
  closeButton: ReactNode;
  onNavigate: (route: McpRoute, opener: HTMLElement) => void;
  onReplace: (route: McpRoute) => void;
  onBack: () => void;
  onServersChange?: (servers: McpServer[]) => void;
}) {
  const { t } = useLingui();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [assignments, setAssignments] = useState<BotMcpServer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingIds, setTestingIds] = useState<Set<string>>(() => new Set());
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // A test can spend minutes installing a package; re-reading the list while it runs lets the
  // status switch from "Checking…" to "Installing…" as soon as the server records it.
  const shouldPoll =
    testingIds.size > 0 || servers.some((server) => mcpHealth(server)?.status === "installing");

  async function refresh() {
    const [nextServers, nextBots, nextAssignments] = await Promise.all([
      rpc.mcp.servers.list(),
      rpc.bots.list(),
      rpc.mcp.assignments.all(),
    ]);
    setServers(nextServers);
    setBots(nextBots.filter((bot) => !bot.archivedAt));
    setAssignments(nextAssignments);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      setLoaded(true);
      setError(errorText(err, t`Could not load MCP servers`));
    });
  }, []);

  useEffect(() => {
    if (loaded) onServersChange?.(servers);
  }, [loaded, servers, onServersChange]);

  useEffect(() => {
    // BroadcastChannel instead of window.opener messaging: provider login pages with COOP
    // sever the opener link, but the channel is origin-scoped and unaffected.
    const channel = new BroadcastChannel(MCP_OAUTH_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type !== "mcp-oauth-complete") return;
      setOauthPending(null);
      void refresh().catch(() => undefined);
    };
    return () => channel.close();
  }, []);

  // Poll only while a package installs or a test runs; servers without health never poll.
  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void rpc.mcp.servers
        .list()
        .then((next) => {
          if (!cancelled) setServers(next);
        })
        .catch((reason) => {
          if (!isRetryableError(reason)) clearInterval(timer);
        });
    }, INSTALL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [shouldPoll]);

  useEffect(() => {
    setError(null);
    setConfirmingRemove(null);
  }, [route]);

  const localFor = (server: McpServer) =>
    host.servers.find((entry) => entry.serverId === server.id);

  function assignedIds(serverId: string) {
    return new Set(
      assignments.filter((entry) => entry.serverId === serverId).map((entry) => entry.botId),
    );
  }

  /** replace() overwrites a bot's whole list, so each change merges with what it has. */
  async function setAgentAccess(serverId: string, botId: string, allowed: boolean) {
    const current = assignments.filter((entry) => entry.botId === botId);
    const next = current
      .filter((entry) => entry.serverId !== serverId)
      .map(({ serverId, allowAllTools, allowedTools }) => ({
        serverId,
        allowAllTools,
        allowedTools,
      }));
    if (allowed) next.push({ serverId, allowAllTools: true, allowedTools: [] });
    const updated = await rpc.mcp.assignments.replace({ botId, assignments: next });
    setAssignments((all) => [...all.filter((entry) => entry.botId !== botId), ...updated]);
  }

  async function toggleAgent(server: McpServer, botId: string) {
    setError(null);
    try {
      await setAgentAccess(server.id, botId, !assignedIds(server.id).has(botId));
    } catch (err) {
      setError(errorText(err, t`Could not update agent access`));
    }
  }

  async function added(server: McpServer, botIds: string[], more: boolean) {
    setServers((current) => [...current.filter((entry) => entry.id !== server.id), server]);
    if (more) toast.success(t`${server.name} added`);
    else onReplace({ view: "detail", serverId: server.id });
    try {
      for (const botId of botIds) await setAgentAccess(server.id, botId, true);
    } catch (err) {
      setError(errorText(err, t`Could not update agent access`));
    }
    await refresh().catch(() => undefined);
  }

  async function testServer(server: McpServer) {
    setError(null);
    setTestingIds((current) => new Set(current).add(server.id));
    try {
      const updated = await rpc.mcp.servers.test({ id: server.id });
      setServers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      const health = mcpHealth(updated);
      if (health?.status === "ok") toast.success(t`${updated.name} is running`);
      else if (health?.status === "error") toast.error(t`${updated.name} is not working`);
    } catch (err) {
      setError(errorText(err, t`Could not test MCP server`));
    } finally {
      setTestingIds((current) => {
        const next = new Set(current);
        next.delete(server.id);
        return next;
      });
    }
  }

  async function connectOAuth(server: McpServer) {
    setError(null);
    setOauthPending(server.id);
    try {
      const result = await connectMcpOauth(server.id);
      if (result !== "cancelled") setOauthPending(null);
      await refresh();
      if (result === "already_connected") {
        setError(t`This server is already connected. Disconnect it first to authorize again.`);
      } else if (result === "authorization_not_requested") {
        setError(t`This server did not request browser authorization.`);
      } else if (result === "cancelled") {
        setOauthPending((current) => (current === server.id ? null : current));
      }
    } catch (err) {
      setError(errorText(err, t`Could not start OAuth`));
      setOauthPending(null);
    }
  }

  async function disconnectOAuth(server: McpServer) {
    setError(null);
    setOauthPending(server.id);
    try {
      await rpc.mcp.oauth.disconnect({ serverId: server.id });
      await refresh();
    } catch (err) {
      setError(errorText(err, t`Could not disconnect OAuth`));
    } finally {
      setOauthPending(null);
    }
  }

  async function removeServer(server: McpServer) {
    if (confirmingRemove !== server.id) {
      setConfirmingRemove(server.id);
      return;
    }
    setConfirmingRemove(null);
    setError(null);
    setRemoving(server.id);
    const local = localFor(server);
    try {
      await rpc.mcp.servers.remove({ id: server.id });
    } catch (err) {
      setError(errorText(err, t`Could not delete MCP server`));
      setRemoving(null);
      return;
    }
    setServers((current) => current.filter((entry) => entry.id !== server.id));
    setRemoving(null);
    if (local && host.bridge) {
      try {
        await host.bridge.remove(local.id);
      } catch {
        toast.error(t`${server.name} was removed, but its setup on this Mac could not be.`);
      }
      void host.refresh();
    }
    onBack();
    void refresh().catch(() => undefined);
  }

  const detailServer =
    route.view === "detail" ? servers.find((server) => server.id === route.serverId) : undefined;

  return (
    <div data-testid="mcp-servers" className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="flex-row items-center justify-between gap-2 px-7 pt-6">
        <Button
          ref={backRef}
          type="button"
          variant="ghost"
          size="sm"
          className="-ms-2 text-muted-foreground"
          aria-label={backAriaLabel}
          onClick={onBack}
        >
          <ArrowLeft className="rtl:rotate-180" />
          {backLabel}
        </Button>
        <div className="flex items-center gap-1">
          {route.view === "list" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-full text-muted-foreground"
              data-mcp-key="add"
              onClick={(event) => onNavigate({ view: "add" }, event.currentTarget)}
            >
              <Plus />
              <Trans>Add server</Trans>
            </Button>
          ) : null}
          {closeButton}
        </div>
      </DialogHeader>
      <div className="rk-scroll flex-1 space-y-5 overflow-y-auto px-7 pt-4 pb-6">
        {route.view === "list" ? (
          <DialogTitle className="text-lg font-medium text-foreground">
            <Trans>MCP servers</Trans>
          </DialogTitle>
        ) : route.view === "add" ? (
          <DialogTitle className="text-lg font-medium text-foreground">
            <Trans>Add MCP server</Trans>
          </DialogTitle>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {!loaded ? (
          <div className="grid place-items-center py-10" aria-busy="true">
            <Spinner className="size-5 text-muted-foreground" aria-label={t`Loading…`} />
          </div>
        ) : route.view === "add" ? (
          <McpServerAdd
            initialSource={route.source}
            initialName={route.name}
            initialAuth={route.auth}
            servers={servers}
            bots={bots}
            host={host}
            onAdded={(server, botIds, more) => void added(server, botIds, more)}
          />
        ) : route.view === "detail" ? (
          detailServer ? (
            <McpServerDetail
              server={detailServer}
              local={localFor(detailServer)}
              bots={bots}
              assignedBotIds={assignedIds(detailServer.id)}
              testing={testingIds.has(detailServer.id)}
              oauthPending={oauthPending === detailServer.id}
              confirmingRemove={confirmingRemove === detailServer.id}
              removing={removing === detailServer.id}
              onToggleAgent={(botId) => void toggleAgent(detailServer, botId)}
              onTest={() => void testServer(detailServer)}
              onConnectOAuth={() => void connectOAuth(detailServer)}
              onDisconnectOAuth={() => void disconnectOAuth(detailServer)}
              onRemove={() => void removeServer(detailServer)}
              onAllowLocal={() => {
                const local = localFor(detailServer);
                if (!local || !host.bridge) return;
                void host.bridge
                  .setEnabled(local.id, true)
                  .then(host.refresh)
                  .catch((err) => setError(errorText(err, t`Could not change Mac access`)));
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>This server is no longer available.</Trans>
            </p>
          )
        ) : servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No MCP servers yet.</Trans>
          </p>
        ) : (
          <ul className="-mx-2">
            {servers.map((server) => {
              const local = localFor(server);
              const status = mcpStatusLabel(server, local);
              return (
                <li key={server.id}>
                  <button
                    type="button"
                    data-testid="mcp-server-row"
                    data-mcp-key={server.id}
                    data-location={mcpServerLocation(server).kind}
                    className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-start outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) =>
                      onNavigate({ view: "detail", serverId: server.id }, event.currentTarget)
                    }
                  >
                    <ConnectorIcon name={server.name} />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm font-medium text-foreground"
                        dir="auto"
                      >
                        {server.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {mcpLocationLabel(server, local, "short")}
                        {status ? (
                          <>
                            {" · "}
                            <span className={mcpStatusTone(server, local)}>{status}</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <ChevronRight
                      size={17}
                      className="shrink-0 text-muted-foreground rtl:rotate-180"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
