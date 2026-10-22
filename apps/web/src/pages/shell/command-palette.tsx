import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { Bot, SearchHit } from "@rakazo/contracts";
import {
  Badge,
  BotAvatar,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Kbd,
} from "@rakazo/ui-web";
import { useEffect, useMemo, useState } from "react";
import { rpc } from "../../lib/rpc";

function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  // platform is deprecated but still the most reliable Apple check in browsers.
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

function botSearchText(bot: Bot) {
  return `${bot.name} ${bot.title} ${bot.description} ${bot.preview}`.toLowerCase();
}

function botSubtitle(bot: Bot) {
  return bot.description.trim() || bot.preview.trim() || bot.title.trim();
}

function botTitleTag(bot: Bot) {
  const title = bot.title.trim();
  if (!title) return null;
  // Title is already the subtitle when there is no description/preview.
  if (!(bot.description.trim() || bot.preview.trim())) return null;
  return title;
}

function hitKey(hit: SearchHit) {
  return `${hit.kind}-${hit.botId ?? hit.groupId}-${hit.messageId ?? hit.artifactId ?? hit.routineId ?? hit.url}`;
}

export function CommandPalette({
  open,
  onOpenChange,
  bots,
  onSelectBot,
  onSelectHit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: Bot[];
  onSelectBot: (botId: string) => void;
  onSelectHit: (hit: SearchHit) => void;
}) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [modKey, setModKey] = useState("⌘");

  useEffect(() => {
    setModKey(isApplePlatform() ? "⌘" : "Ctrl");
  }, []);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filteredBots = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return bots;
    return bots.filter((bot) => botSearchText(bot).includes(needle));
  }, [bots, search]);

  // Bots filter locally; chats come from the bounded server search.
  const chatQuery = open ? search.trim() : "";
  useEffect(() => {
    if (!chatQuery) {
      setHits([]);
      setSearching(false);
      return;
    }
    const abort = new AbortController();
    setHits([]);
    setSearching(true);
    const timer = window.setTimeout(() => {
      void rpc.search
        .query({ q: chatQuery }, { signal: abort.signal })
        .then((result) => {
          if (!abort.signal.aborted) setHits(result.hits);
        })
        .catch(() => {
          if (!abort.signal.aborted) setHits([]);
        })
        .finally(() => {
          if (!abort.signal.aborted) setSearching(false);
        });
    }, 200);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [chatQuery]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) {
        return;
      }
      if (!/^[1-9]$/.test(event.key)) return;
      const bot = filteredBots[Number(event.key) - 1];
      if (!bot) return;
      event.preventDefault();
      onSelectBot(bot.id);
      onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredBots, onOpenChange, onSelectBot, open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t`Search`}
      description={t`Search bots and chats`}
      className="sm:max-w-xl"
    >
      <Command
        shouldFilter={false}
        className="rounded-xl! bg-popover"
        data-testid="command-palette"
      >
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder={t`Search`}
          data-testid="command-palette-search"
        />
        <CommandList className="max-h-96" data-testid="command-palette-list">
          {searching && filteredBots.length === 0 && hits.length === 0 ? (
            <div role="status" className="py-6 text-center text-sm text-muted-foreground">
              <Trans>Searching…</Trans>
            </div>
          ) : (
            <CommandEmpty>
              <Trans>No results</Trans>
            </CommandEmpty>
          )}
          <CommandGroup>
            {filteredBots.map((bot, index) => {
              const subtitle = botSubtitle(bot);
              const titleTag = botTitleTag(bot);
              const shortcut = index < 9 ? `${modKey}${index + 1}` : null;
              return (
                <CommandItem
                  key={bot.id}
                  value={bot.id}
                  data-testid={`command-palette-bot-${bot.id}`}
                  onSelect={() => {
                    onSelectBot(bot.id);
                    onOpenChange(false);
                  }}
                  className="items-center gap-3 rounded-xl! px-2.5 py-2.5"
                >
                  <BotAvatar color={bot.color} identity={bot.id} size={32} status={bot.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-foreground" dir="auto">
                        {bot.name}
                      </span>
                      {titleTag ? (
                        <Badge
                          variant="secondary"
                          className="max-w-[40%] truncate rounded-full px-1.5 py-0 text-[11px] font-normal text-muted-foreground"
                        >
                          {titleTag}
                        </Badge>
                      ) : null}
                    </div>
                    {subtitle ? (
                      <div className="mt-0.5 truncate text-[13px] text-muted-foreground" dir="auto">
                        {subtitle}
                      </div>
                    ) : null}
                  </div>
                  {shortcut ? (
                    <CommandShortcut className="tracking-normal">
                      <Kbd>{shortcut}</Kbd>
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
          {hits.length > 0 ? (
            <CommandGroup heading={t`Chats`} data-testid="command-palette-chats">
              {hits.map((hit) => (
                <CommandItem
                  key={hitKey(hit)}
                  value={`hit:${hitKey(hit)}`}
                  onSelect={() => {
                    onSelectHit(hit);
                    onOpenChange(false);
                  }}
                  className="items-start gap-3 rounded-xl! px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-foreground" dir="auto">
                        {hit.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {hit.groupName ?? hit.botName}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted-foreground" dir="auto">
                      {hit.snippet}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export { isCommandPaletteHotkey } from "./command-palette-hotkey";
