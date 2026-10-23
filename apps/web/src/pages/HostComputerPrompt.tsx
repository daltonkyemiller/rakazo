import { Trans, useLingui } from "@lingui/react/macro";
import type { Me } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Switch,
} from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import { useParams } from "react-router-dom";
import { MacAccessRow } from "../components/MacAccess";
import { sandboxCheckFailureMessage } from "../lib/computer-sandbox";
import { desktopBridge } from "../lib/desktop";
import {
  ensureMacComputer,
  notifyComputerAccessChanged,
  onOpenComputerAccess,
  setBotMacAccess,
} from "../lib/mac-access";
import { HostMcpCleanupError } from "../lib/mcp-host";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/**
 * `choose` is the either/or choice for desktop releases without the Mac bridge. With the bridge,
 * bots keep their own isolated computers and Mac access is granted per bot instead.
 */
type View = "choose" | "isolated" | "legacy" | "transition";

export function HostComputerPrompt({
  initialMe,
  onMeUpdated,
}: {
  initialMe?: Me;
  onMeUpdated?: (me: Me) => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const { botId } = useParams();
  const desktop = desktopBridge();
  const [configuring, setConfiguring] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [computerHost, setComputerHost] = useState<Me["computerHost"]>(null);
  const [botName, setBotName] = useState<string | null>(null);
  const [keepMacAccess, setKeepMacAccess] = useState(true);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mac = desktop?.platform === "darwin";
  const hostLabel = mac ? t`this Mac` : t`this computer`;

  async function show(me: Me, closable: boolean) {
    const native = await desktop?.mcp?.state().catch(() => null);
    setConfiguring(closable);
    setComputerHost(me.computerHost);
    setError(null);
    if (!native?.available) setView("choose");
    else if (me.computerHost === "this-mac") setView("legacy");
    else setView("isolated");
  }

  useEffect(() => {
    if (!desktop?.computer) return;
    const configure = () => {
      void rpc
        .me()
        .then((me) => (me.canChooseHostComputer ? show(me, me.computerHost != null) : undefined))
        .catch(() => undefined);
    };
    const stopMenu = desktop.computer.onConfigure(configure);
    const stopInApp = onOpenComputerAccess(configure);
    return () => {
      stopMenu();
      stopInApp();
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    if (initialMe) {
      if (initialMe.canChooseHostComputer && initialMe.computerHost == null)
        void show(initialMe, false);
      return;
    }
    void rpc
      .me()
      .then((me) => {
        if (me.canChooseHostComputer && me.computerHost == null) return show(me, false);
      })
      .catch(() => undefined);
  }, [desktop, initialMe]);

  useEffect(() => {
    if (view !== "transition" || !botId) return;
    setBotName(null);
    void rpc.bots
      .get({ botId })
      .then((bot) => setBotName(bot.name))
      .catch(() => undefined);
  }, [view, botId]);

  if (!view) return null;

  async function refreshMe() {
    try {
      const me = await rpc.me();
      onMeUpdated?.(me);
    } catch {
      // The choice is already saved. A failed refresh must not look like a failed save.
    }
  }

  async function refreshChoiceState() {
    setChecking(true);
    setError(null);
    try {
      const me = await rpc.me();
      onMeUpdated?.(me);
      if (!me.canChooseHostComputer || me.computerHost != null) {
        setView(null);
      }
    } catch (err) {
      setError(sandboxCheckFailureMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function choose(choice: "docker" | "this-mac") {
    setPending(true);
    setError(null);
    try {
      if (choice === "this-mac") {
        if (!desktop?.computer)
          throw new Error(t`Local computer access requires the latest desktop app.`);
        if (!(await desktop.computer.requestAccess())) {
          setPending(false);
          return;
        }
      } else {
        await desktop?.computer?.revokeAccess();
      }
      await rpc.deployment.update({ computerHost: choice });
    } catch (err) {
      setError(errorText(err, t`Could not save that choice`));
      setPending(false);
      return;
    }
    await refreshMe();
    setView(null);
    setPending(false);
  }

  /**
   * Moves every bot's primary computer off this Mac. This is a location change, not a revocation:
   * Mac access stays approved, and files already on the Mac are neither moved nor deleted.
   */
  async function switchToIsolatedComputers(grantMacAccess: boolean) {
    const mcp = desktop?.mcp;
    setPending(true);
    setError(null);
    try {
      if (grantMacAccess && botId && mcp) {
        const server = await ensureMacComputer(mcp);
        if (!server) return;
        await setBotMacAccess(botId, server.id);
      }
      await rpc.deployment.update({ computerHost: "docker" });
      setComputerHost("docker");
      await refreshMe();
      notifyComputerAccessChanged();
      setView(null);
    } catch (err) {
      setError(
        err instanceof HostMcpCleanupError
          ? t`Mac setup did not finish. Revoke Mac access from the Rakazo menu, then try again.`
          : errorText(err, t`Could not save that choice`),
      );
    } finally {
      setPending(false);
    }
  }

  const busy = pending || checking;
  const errorLine = error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;

  // A first choice is required, so the dialog stays open until one is saved.
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (configuring && !next) setView(null);
      }}
    >
      <DialogContent showCloseButton={configuring} className="rounded-2xl p-6 sm:max-w-[440px]">
        {view === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[22px]">
                <Trans>Where should bots run?</Trans>
              </DialogTitle>
              <DialogDescription className="space-y-2 leading-relaxed">
                <span className="block">
                  <Trans>
                    Docker limits access to your computer for added security. Using {hostLabel} lets
                    bots work with your local files and tools.
                  </Trans>
                </span>
                <span className="block text-xs text-muted-foreground/80">
                  <Trans>
                    Local access lets bots run commands without asking. Avoid it on shared or public
                    servers.
                  </Trans>
                </span>
              </DialogDescription>
            </DialogHeader>
            {errorLine}
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => void choose("docker")}
              >
                <Trans>Docker</Trans>
              </Button>
              <Button
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => void choose("this-mac")}
              >
                <Trans>Use {hostLabel}</Trans>
              </Button>
            </div>
            {error ? (
              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  disabled={busy}
                  onClick={() => void refreshChoiceState()}
                >
                  {checking ? <Trans>Checking…</Trans> : <Trans>Check again</Trans>}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {view === "isolated" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[22px]">
                <Trans>Computer access</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>Bots run on isolated computers.</Trans>
              </DialogDescription>
            </DialogHeader>
            {botId ? <MacAccessRow botId={botId} /> : null}
            {errorLine}
            {computerHost == null ? (
              <Button
                size="lg"
                disabled={busy}
                onClick={() => void switchToIsolatedComputers(false)}
              >
                <Trans>Continue</Trans>
              </Button>
            ) : null}
          </>
        ) : null}
        {view === "legacy" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[22px]">
                <Trans>Computer access</Trans>
              </DialogTitle>
              <DialogDescription>
                <Trans>Bots run directly on this Mac.</Trans>
              </DialogDescription>
            </DialogHeader>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setKeepMacAccess(Boolean(botId));
                setView("transition");
              }}
            >
              <Trans>Use isolated computers</Trans>
            </Button>
          </>
        ) : null}
        {view === "transition" ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[22px]">
                <Trans>Use isolated computers?</Trans>
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                <Trans>
                  This applies to every bot. Files on this Mac stay where they are, and bots with
                  Mac access can still use them.
                </Trans>
              </DialogDescription>
            </DialogHeader>
            {botId ? (
              <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <label
                    htmlFor={`${ids}-keep-mac`}
                    id={`${ids}-keep-mac-label`}
                    className="text-sm text-foreground"
                  >
                    {botName ? <Trans>Mac access for {botName}</Trans> : <Trans>Mac access</Trans>}
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <Trans>Commands and files</Trans>
                  </p>
                </div>
                <Switch
                  id={`${ids}-keep-mac`}
                  aria-labelledby={`${ids}-keep-mac-label`}
                  checked={keepMacAccess}
                  disabled={busy}
                  onCheckedChange={setKeepMacAccess}
                />
              </div>
            ) : null}
            {errorLine}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setView("legacy")}>
                <Trans>Back</Trans>
              </Button>
              <Button disabled={busy} onClick={() => void switchToIsolatedComputers(keepMacAccess)}>
                <Trans>Switch</Trans>
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
