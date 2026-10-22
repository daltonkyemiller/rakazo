import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { Bot, ComputerStatus, Routine } from "@rakazo/contracts";
import { BotAvatar } from "@rakazo/ui-web";
import { Maximize2 } from "lucide-react";
import type { ReactNode } from "react";
import { ComputerMaintenanceActions } from "../../components/ComputerMaintenanceActions";
import { ComputersUnavailableHint } from "../../components/ComputersUnavailableHint";
import { screenIframeSandbox } from "../../lib/computer-screen";
import { computerPanelNeedsMaintenance } from "../../lib/thread-events";
import { RoutineListHeader, RoutineListRow } from "../RoutineEditor";
import { BotPanelHero } from "./bot-panel";
import { computerLabel, computerPlaceholder, DesktopKindEmptyState } from "./computer-view";

type ComputerPanelProps = {
  bot: Bot;
  nav?: ReactNode;
  onComputerChanged: () => Promise<void>;
  computer: ComputerStatus | null;
  computerOpen: boolean;
  embeddedScreenUrl: string | null;
  screenFrameRef: (frame: HTMLIFrameElement | null) => void;
  computerScreenError: ReactNode;
  computerBooting: ReactNode;
  booting: boolean;
  showingRecoveryHint: boolean;
  showComputerRecoveryHint: boolean;
  sandboxProvider?: string | null;
  onRecovered: (sandboxProvider: string) => void;
  onRecoveryDismissed: () => void;
  onOpenComputerSettings?: () => void;
  onOpen: () => void;
  routines: Routine[];
  runningRoutineId?: string;
  onCreateRoutine: () => void;
  onEditRoutine: (routine: Routine) => void;
  onStopRun: () => void;
};

export function ComputerPanel({
  bot,
  nav,
  onComputerChanged,
  computer,
  computerOpen,
  embeddedScreenUrl,
  screenFrameRef,
  computerScreenError,
  computerBooting,
  booting,
  showingRecoveryHint,
  showComputerRecoveryHint,
  sandboxProvider,
  onRecovered,
  onRecoveryDismissed,
  onOpenComputerSettings,
  onOpen,
  routines,
  runningRoutineId,
  onCreateRoutine,
  onEditRoutine,
  onStopRun,
}: ComputerPanelProps) {
  return (
    <div>
      <BotPanelHero
        avatar={<BotAvatar color={bot.color} identity={bot.id} size={64} status={bot.status} />}
        name={bot.name}
        title={bot.title}
        nav={nav}
      />
      <div
        data-testid="computer-preview"
        className={`group relative mt-5 rounded-[14px] bg-background ${
          showingRecoveryHint ? "" : "aspect-[16/10] overflow-hidden"
        }`}
      >
        {computerOpen ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground/80">
            <Trans>Open in full window</Trans>
          </div>
        ) : computer?.kind === "desktop" ? (
          <DesktopKindEmptyState className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground/80" />
        ) : computer?.state === "running" && embeddedScreenUrl && !computerScreenError ? (
          <iframe
            title={t`Bot screen preview`}
            ref={screenFrameRef}
            src={embeddedScreenUrl}
            sandbox={screenIframeSandbox(embeddedScreenUrl)}
            className="h-full w-full border-0 bg-black"
            allow="clipboard-read; clipboard-write"
            style={{ pointerEvents: "none" }}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground/80">
            {computerScreenError ??
              (showComputerRecoveryHint ? (
                <ComputersUnavailableHint
                  sandboxProvider={sandboxProvider}
                  onRecovered={onRecovered}
                  onRecoveryDismissed={onRecoveryDismissed}
                  onOpenComputerSettings={onOpenComputerSettings}
                />
              ) : (
                (computerBooting ??
                computerPlaceholder(
                  computer?.state,
                  booting,
                  computerLabel(computer?.mode, bot.name),
                ))
              ))}
          </div>
        )}
        {!computerScreenError && !showingRecoveryHint ? (
          <button
            type="button"
            data-testid="computer-preview-open"
            className="absolute inset-0 flex cursor-pointer items-center justify-center bg-overlay/40 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t`Open`}
            onClick={onOpen}
          >
            <span className="inline-flex items-center gap-2 rounded-full bg-overlay px-3.5 py-2 text-[14px] text-foreground shadow-md">
              <Maximize2 size={15} strokeWidth={1.9} aria-hidden />
              <Trans>Open</Trans>
            </span>
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex min-h-7 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground" dir="auto">
          {t`${bot.name}'s screen`}
        </p>
        {computer?.state ? (
          <span className="shrink-0 text-[12.5px] text-muted-foreground/80">{computer.state}</span>
        ) : null}
        {!computerOpen && computerPanelNeedsMaintenance(computer?.state, booting) ? (
          <ComputerMaintenanceActions
            botId={bot.id}
            computer={computer}
            onChanged={onComputerChanged}
          />
        ) : null}
      </div>

      <RoutineListHeader onCreate={onCreateRoutine} />
      {routines.map((routine) => (
        <RoutineListRow
          key={routine.id}
          routine={routine}
          running={runningRoutineId === routine.id}
          onOpen={() => onEditRoutine(routine)}
          onStop={onStopRun}
        />
      ))}
    </div>
  );
}
