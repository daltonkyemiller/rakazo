import { Trans, useLingui } from "@lingui/react/macro";
import type { DesktopHostMcpServer, McpServer, Me } from "@rakazo/contracts";
import { macComputerServers } from "@rakazo/core";
import { Button, Switch } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import {
  ensureMacComputer,
  notifyComputerAccessChanged,
  onComputerAccessChanged,
  openComputerAccess,
  setBotMacAccess,
} from "../lib/mac-access";
import { HostMcpCleanupError } from "../lib/mcp-host";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type MacAccessData = {
  me: Pick<Me, "computerHost" | "canChooseHostComputer">;
  macServers: McpServer[];
  assignedIds: string[];
  /** Null off the host: phones, browsers, and desktop releases without the Mac bridge. */
  hosted: DesktopHostMcpServer[] | null;
};

/** One bot's access to the Mac's commands and files, kept apart from its own computer. */
export function MacAccessRow({ botId, className }: { botId: string; className?: string }) {
  const { t } = useLingui();
  const id = useId();
  const desktop = desktopBridge();
  const [data, setData] = useState<MacAccessData | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [me, servers, assignments, native] = await Promise.all([
      rpc.me(),
      rpc.mcp.servers.list(),
      rpc.mcp.assignments.list({ botId }),
      desktop?.mcp?.state().catch(() => null) ?? null,
    ]);
    setData({
      me,
      macServers: macComputerServers(servers),
      assignedIds: assignments.map((assignment) => assignment.serverId),
      hosted: native?.available
        ? native.servers.filter((server) => server.kind === "computer")
        : null,
    });
  }, [botId, desktop]);

  useEffect(() => {
    setData(null);
    setError(null);
    const reload = () => void load().catch(() => undefined);
    reload();
    return onComputerAccessChanged(reload);
  }, [load]);

  if (!data) return null;

  const legacyHost = data.me.computerHost === "this-mac";
  const assigned = data.macServers.filter((server) => data.assignedIds.includes(server.id));
  const hostedHere = (server: McpServer) =>
    data.hosted?.find((native) => native.serverId === server.id);
  const sharedMacServer = data.macServers.find((server) => server.enabled);
  const canGrant = data.hosted !== null || sharedMacServer !== undefined;
  const checked = assigned.length > 0;

  async function toggle(next: boolean) {
    if (!data) return;
    const mcp = desktop?.mcp;
    setPending(true);
    setError(null);
    try {
      if (!next) {
        await setBotMacAccess(botId, null);
      } else {
        const server = data.hosted && mcp ? await ensureMacComputer(mcp) : sharedMacServer;
        if (!server) return;
        await setBotMacAccess(botId, server.id);
      }
      notifyComputerAccessChanged();
    } catch (err) {
      setError(
        err instanceof HostMcpCleanupError
          ? t`Mac setup did not finish. Revoke Mac access from the Rakazo menu, then try again.`
          : errorText(err, t`Could not change Mac access`),
      );
    } finally {
      setPending(false);
    }
  }

  let note = t`Commands and files`;
  if (legacyHost) note = t`Bots already run on your Mac.`;
  else if (!checked && !canGrant)
    note =
      desktop?.platform === "darwin" && !desktop.mcp
        ? t`Update Rakazo on this Mac to allow it.`
        : t`Allow it from Rakazo on your Mac.`;
  else if (checked) {
    const native = assigned.map(hostedHere).find(Boolean);
    if (native && (native.status === "error" || !native.enabled))
      note = native.error ?? t`Off on this Mac.`;
    else if (!native && assigned.some((server) => server.health?.status === "error"))
      note = t`Open Rakazo on your Mac to use it.`;
  }

  let control: ReactNode = null;
  if (legacyHost) {
    if (desktop?.computer && data.me.canChooseHostComputer)
      control = (
        <Button variant="ghost" size="sm" onClick={openComputerAccess}>
          <Trans>Change</Trans>
        </Button>
      );
  } else if (checked || canGrant) {
    control = (
      <Switch
        id={`${id}-mac`}
        aria-labelledby={`${id}-mac-label`}
        checked={checked}
        disabled={pending}
        onCheckedChange={(next) => void toggle(next)}
      />
    );
  }

  return (
    <div data-testid="mac-access" className={className}>
      <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
        <div className="min-w-0">
          <label htmlFor={`${id}-mac`} id={`${id}-mac-label`} className="text-sm text-foreground">
            <Trans>Mac access</Trans>
          </label>
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        </div>
        {control}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
