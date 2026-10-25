import { useLingui } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { Bell, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { desktopBridge } from "../../lib/desktop";
import type { Panel } from "../../lib/right-panel-state";
import { WindowChrome } from "../WindowChrome";
import { BotCreatePicker } from "./bot-picker";
import { isCreateMenuHotkey } from "./command-palette-hotkey";

/** Selected state keeps the sidebar material and foreground so it reads in both themes. */
const SIDEBAR_TOOL_BUTTON =
  "app-no-drag grid size-8 place-items-center rounded-full border border-sidebar-border bg-sidebar-accent text-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-foreground/25 aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground";

export function SidebarHeader({
  mini = false,
  activityMode,
  toggleActivityMode,
  onSearch,
  bots,
  setMobileSidebarOpen,
  setPanel,
  navigate,
  setNewSpaceOpen,
  setCreateBotOpen,
  setPickerInfoTopic,
}: {
  mini?: boolean;
  activityMode: boolean;
  toggleActivityMode: () => void;
  onSearch: () => void;
  bots: Bot[];
  setMobileSidebarOpen: (open: boolean) => void;
  setPanel: (panel: Panel) => void;
  navigate: (path: string) => void;
  setNewSpaceOpen: (open: boolean) => void;
  setCreateBotOpen: (open: boolean) => void;
  setPickerInfoTopic: (topic: "group" | "space") => void;
}) {
  const { t } = useLingui();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const hasWindowChrome = Boolean(desktopBridge());
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isCreateMenuHotkey(event)) return;
      event.preventDefault();
      setCreateMenuOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className={`app-drag flex items-center ${mini ? `flex-col gap-2 px-0 pb-2 ${hasWindowChrome ? "pt-4" : "pt-2"}` : "justify-between px-3 pb-2.5 pt-3"}`}
    >
      {!mini || hasWindowChrome ? <WindowChrome /> : null}
      <div className={`relative flex items-center ${mini ? "flex-col gap-1.5" : "gap-2"}`}>
        <IconTooltip label={t`Activity`}>
          <button
            type="button"
            aria-label={t`Activity`}
            aria-pressed={activityMode}
            data-activity-mode={activityMode ? "on" : "off"}
            onClick={toggleActivityMode}
            className={SIDEBAR_TOOL_BUTTON}
          >
            <Bell
              size={15}
              strokeWidth={1.8}
              fill={activityMode ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
        </IconTooltip>
        <IconTooltip label={t`Search`}>
          <button
            type="button"
            aria-label={t`Search`}
            aria-haspopup="dialog"
            data-testid="sidebar-search-trigger"
            onClick={onSearch}
            className={SIDEBAR_TOOL_BUTTON}
          >
            <Search size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </IconTooltip>
        <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
          <IconTooltip label={t`Create`}>
            <PopoverTrigger
              className={`${SIDEBAR_TOOL_BUTTON} data-popup-open:text-foreground`}
              aria-label={t`Create`}
              data-testid="create-menu-trigger"
            >
              <Plus size={16} strokeWidth={1.9} aria-hidden="true" />
            </PopoverTrigger>
          </IconTooltip>
          {/* Unmount with the state change so the panel it opens never coexists with the menu. */}
          {createMenuOpen ? (
            <PopoverContent
              align="end"
              className="app-no-drag w-auto gap-0 overflow-hidden p-0 data-closed:animate-none"
            >
              <BotCreatePicker
                bots={bots}
                onCreateBot={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setCreateBotOpen(true);
                }}
                onOpenBot={(id) => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  navigate(`/app/${id}`);
                }}
                onCreateGroup={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setPanel("create-group");
                }}
                onCreateSpace={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setNewSpaceOpen(true);
                }}
                onShowGroupInfo={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setPickerInfoTopic("group");
                }}
                onShowSpaceInfo={() => {
                  setCreateMenuOpen(false);
                  setMobileSidebarOpen(false);
                  setPickerInfoTopic("space");
                }}
              />
            </PopoverContent>
          ) : null}
        </Popover>
      </div>
    </div>
  );
}
