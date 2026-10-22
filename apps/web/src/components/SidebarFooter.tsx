import { Trans, useLingui } from "@lingui/react/macro";
import { ANDROID_APK_URL, IOS_APP_STORE_URL } from "@rakazo/contracts";
import {
  AppMarkStack,
  Button,
  buttonVariants,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rakazo/ui-web";
import {
  Blocks,
  BookOpen,
  Download,
  FolderOpen,
  Gauge,
  LogOut,
  Plug,
  Settings,
  Smartphone,
  SquareKanban,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useSidebarUpdate } from "./DesktopUpdates";
import { IconTooltip } from "./IconTooltip";

type Props = {
  mini?: boolean;
  name: string;
  initials: string | null;
  image?: string | null;
  logos?: Array<{ name: string; logo?: string | null }>;
  email?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIntegrations: () => void;
  onBoard?: () => void;
  onArtifacts: () => void;
  onSettings: () => void;
  onUsage: () => void;
  onLogOut: () => void;
  signingOut: boolean;
  logOutError: string | null;
};

export function SidebarFooter({
  mini = false,
  name,
  initials,
  image,
  logos = [],
  email,
  open,
  onOpenChange,
  onIntegrations,
  onBoard,
  onArtifacts,
  onSettings,
  onUsage,
  onLogOut,
  signingOut,
  logOutError,
}: Props) {
  const { t } = useLingui();
  const update = useSidebarUpdate();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return (
    <div
      data-testid="sidebar-footer"
      className={`flex shrink-0 items-center gap-2 bg-transparent ${mini ? "flex-col px-1 py-2" : "px-3 py-3"}`}
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          data-testid="user-menu-trigger"
          aria-label={t`Account menu for ${name}`}
          className={`flex h-9 items-center rounded-full border border-sidebar-border bg-sidebar-accent text-start text-[13px] font-medium text-foreground outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:border-foreground/20 ${
            mini ? "w-9 shrink-0 justify-center" : "min-w-0 flex-1 gap-2 ps-1 pe-3"
          }`}
        >
          <span
            data-testid="user-menu-avatar"
            className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
          >
            {image && failedImage !== image ? (
              <img
                src={image}
                alt=""
                className="size-full object-cover"
                onError={() => setFailedImage(image)}
              />
            ) : initials ? (
              initials
            ) : (
              <UserRound size={16} aria-hidden="true" />
            )}
          </span>
          {mini ? null : (
            <span className="min-w-0 truncate" dir="auto">
              {name}
            </span>
          )}
        </PopoverTrigger>
        {open ? (
          <PopoverContent
            side="top"
            sideOffset={8}
            align="start"
            className="max-h-(--available-height) w-[276px] max-w-[calc(100vw-72px)] gap-0 overflow-y-auto p-1 *:shrink-0 data-closed:animate-none"
          >
            <div
              data-testid="account-menu-header"
              className="mb-1 min-w-0 border-b border-border px-2.5 py-2.5"
            >
              <p className="truncate text-sm font-medium">{name}</p>
              {email && email !== name ? (
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              ) : null}
            </div>
            {mini ? (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={onIntegrations}
              >
                <Plug className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Connect apps</Trans>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2.5 font-normal"
              onClick={onUsage}
            >
              <Gauge className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Usage</Trans>
            </Button>
            <a
              className={`${buttonVariants({ variant: "ghost" })} h-9 w-full justify-start gap-2.5 font-normal`}
              href={/Android/i.test(navigator.userAgent) ? ANDROID_APK_URL : IOS_APP_STORE_URL}
              target="_blank"
              rel="noreferrer"
            >
              <Smartphone className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Get the mobile app</Trans>
            </a>
            <a
              className={`${buttonVariants({ variant: "ghost" })} h-9 w-full justify-start gap-2.5 font-normal`}
              href="https://github.com/elie222/rakazo/blob/main/docs/self-host.md"
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Docs</Trans>
            </a>
            {onBoard ? (
              <Button
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={onBoard}
              >
                <SquareKanban className="text-muted-foreground" strokeWidth={1.75} />
                <Trans>Board</Trans>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2.5 font-normal"
              onClick={onArtifacts}
            >
              <FolderOpen className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Artifacts</Trans>
            </Button>
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2.5 font-normal"
              aria-label={t`Settings`}
              onClick={onSettings}
            >
              <Settings className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Settings</Trans>
            </Button>
            <div className="my-1 border-t border-border" />
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2.5 font-normal"
              disabled={signingOut}
              onClick={onLogOut}
            >
              <LogOut className="text-muted-foreground" strokeWidth={1.75} />
              <Trans>Log out</Trans>
            </Button>
            {logOutError ? (
              <p role="alert" className="px-2.5 pt-1 pb-2 text-[13px] text-destructive">
                {logOutError}
              </p>
            ) : null}
          </PopoverContent>
        ) : null}
      </Popover>
      {!mini ? (
        <IconTooltip label={t`Connect apps`}>
          <Button
            variant="outline"
            aria-label={t`Connect apps`}
            data-testid="connect-apps-trigger"
            onClick={onIntegrations}
            className="h-9 shrink-0 gap-0 rounded-full border-sidebar-border bg-sidebar-accent px-2 hover:border-foreground/20 hover:bg-sidebar-accent dark:hover:bg-sidebar-accent"
          >
            {logos.length > 0 ? (
              <AppMarkStack marks={logos.slice(0, 3)} ringClassName="ring-sidebar-accent" />
            ) : (
              <Blocks size={17} strokeWidth={1.75} className="mx-0.5" aria-hidden="true" />
            )}
          </Button>
        </IconTooltip>
      ) : null}
      {update.available ? (
        <IconTooltip label={t`Install update`}>
          <Button
            size="icon-lg"
            className="rounded-full"
            aria-label={t`Install update`}
            disabled={update.busy}
            onClick={update.install}
          >
            <Download aria-hidden="true" />
          </Button>
        </IconTooltip>
      ) : null}
    </div>
  );
}
