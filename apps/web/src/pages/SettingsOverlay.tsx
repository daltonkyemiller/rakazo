import { useLingui } from "@lingui/react/macro";
import type { AvatarStyle, SpaceMemoryConfig } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Input,
  OptionSelect,
} from "@rakazo/ui-web";
import {
  Brain,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  Cpu,
  CreditCard,
  Gauge,
  Monitor,
  Search,
  Settings,
  ShieldCheck,
  Volume2,
  XIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApprovalRulesSettings } from "../components/ApprovalRulesSettings";
import { computersAreUnavailable } from "../components/ComputersUnavailableHint";
import { settingsTargetId } from "../components/SettingsLayout";
import { hasServerUpdates, useServerUpdateStatus } from "../components/SoftwareUpdateSection";
import { desktopBridge } from "../lib/desktop";
import { usePasskeysSupported } from "../lib/passkeys";
import { rpcForSpace } from "../lib/rpc";
import type { SettingsSearchItem } from "../lib/settings-search";
import { searchSettings } from "../lib/settings-search";
import { SpaceRpcProvider } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import {
  ComputerSettingsPanel,
  GeneralSettingsPanels,
  UpdatesSettingsPanel,
  UsageSettingsPanel,
} from "./AccountSettingsOverlay";
import { BillingSettingsPanel } from "./BillingSettingsPanel";
import { MemorySettingsOverlay } from "./MemorySettingsOverlay";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";
import { MEMORY_PROVIDER_SETTINGS } from "./memory-providers/registry";
import { VoiceSettingsOverlay } from "./VoiceSettingsOverlay";

export type SettingsSection =
  | "general"
  | "models"
  | "memory"
  | "voice"
  | "confirmations"
  | "usage"
  | "computer"
  | "billing"
  | "updates";

/** Sections whose settings belong to a space; only these show the space picker. */
const SPACE_SECTIONS: ReadonlySet<SettingsSection> = new Set([
  "models",
  "memory",
  "voice",
  "confirmations",
]);

type NavItem = {
  id: SettingsSection;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

/** Untranslated synonyms; translated labels are always searched too. */
const SECTION_KEYWORDS: Record<SettingsSection, readonly string[]> = {
  general: ["preferences", "profile"],
  models: ["llm", "ai", "provider"],
  memory: ["recall", "remember", "knowledge"],
  voice: ["speech", "audio", "speak", "read aloud", "tts", "dictation"],
  confirmations: ["approvals", "permissions", "safety", "ask first"],
  usage: ["tokens", "runs", "spend", "cost", "stats"],
  computer: ["sandbox", "docker", "vm"],
  billing: ["plan", "subscription", "payment", "invoice", "credits", "seats"],
  updates: ["version", "upgrade", "download"],
};

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const REVEAL_TIMEOUT_MS = 4000;
const REVEAL_HIGHLIGHT_MS = 1600;

export function SettingsOverlay({
  space,
  spaces = [],
  currentSpaceId,
  onSpaceChange,
  email,
  name,
  usage,
  onUsageOpen,
  initialSection = "general",
  avatarStyle,
  onAvatarStyleChange,
  timezone,
  onTimezoneChange,
  isDeploymentOwner = false,
  billingEnabled = false,
  sandboxProvider,
  onSandboxProviderChange,
  messagingEnabled = false,
  onOpenMessaging,
  memoryConfig,
  onMemoryConfigChange,
  onClose,
  onVoiceStatusMaybeChanged,
}: {
  /** The space the per-space sections act on; it need not be the selected space. */
  space?: { id: string; name: string } | null;
  spaces?: { id: string; name: string }[];
  /** The space the app is showing; its memory config comes from the shell. */
  currentSpaceId?: string | null;
  onSpaceChange?: (spaceId: string) => void;
  email?: string | null;
  name: string;
  usage?: {
    runs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens?: number | null;
  } | null;
  onUsageOpen: () => void;
  initialSection?: SettingsSection;
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => Promise<void>;
  timezone: string | null;
  onTimezoneChange: (timezone: string) => Promise<void>;
  isDeploymentOwner?: boolean;
  billingEnabled?: boolean;
  sandboxProvider?: string | null;
  onSandboxProviderChange?: (sandboxProvider: string) => void;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  memoryConfig: SpaceMemoryConfig | null | undefined;
  onMemoryConfigChange: (config: SpaceMemoryConfig | null) => void;
  onClose: () => void;
  onVoiceStatusMaybeChanged?: () => void | Promise<void>;
}) {
  const { t, i18n } = useLingui();
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [navOverflow, setNavOverflow] = useState({ previous: false, next: false });
  const usageRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resultsId = useId();
  const [query, setQuery] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  // A fresh object per pick, so choosing the same result again reveals it again.
  const [reveal, setReveal] = useState<{ target: string } | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [keepComputerRecovery, setKeepComputerRecovery] = useState(false);
  const recoveryHoldTimer = useRef<number | undefined>(undefined);
  const showComputer =
    keepComputerRecovery || (isDeploymentOwner && computersAreUnavailable(sandboxProvider));
  const serverUpdate = useServerUpdateStatus(isDeploymentOwner);
  const showUpdates = Boolean(desktopBridge()?.update) || hasServerUpdates(serverUpdate);
  const panelBusy = memoryBusy || voiceBusy;
  const spaceScoped = SPACE_SECTIONS.has(section);
  const spaceId = spaceScoped ? (space?.id ?? null) : null;
  // The shell only holds the selected space's memory config; another space's loads here.
  const otherSpace = Boolean(spaceId && currentSpaceId && spaceId !== currentSpaceId);
  // Kept with the space it was loaded for, so a switch never shows the previous space's config.
  const [otherMemory, setOtherMemory] = useState<
    { spaceId: string } & (
      | { config: SpaceMemoryConfig | null; error?: never }
      | { config?: never; error: string }
    )
  >();
  const [memoryLoadAttempt, setMemoryLoadAttempt] = useState(0);
  const otherMemoryError = otherMemory?.spaceId === spaceId ? otherMemory.error : undefined;
  const otherMemoryConfig = otherMemory?.spaceId === spaceId ? otherMemory.config : undefined;
  const setOtherMemoryConfig = useCallback(
    (config: SpaceMemoryConfig | null) => {
      if (spaceId) setOtherMemory({ spaceId, config });
    },
    [spaceId],
  );
  useEffect(() => {
    if (section !== "memory" || !otherSpace || !spaceId) return;
    let cancelled = false;
    setOtherMemory(undefined);
    rpcForSpace(spaceId)
      .memory.providerConfig()
      .then((config) => {
        if (!cancelled) setOtherMemory({ spaceId, config });
      })
      .catch((err: unknown) => {
        if (!cancelled) setOtherMemory({ spaceId, error: errorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [section, otherSpace, spaceId, memoryLoadAttempt]);
  const releaseComputerRecovery = useCallback(() => {
    window.clearTimeout(recoveryHoldTimer.current);
    recoveryHoldTimer.current = undefined;
    setKeepComputerRecovery(false);
  }, []);
  const holdComputerRecovery = useCallback(() => {
    setKeepComputerRecovery(true);
    window.clearTimeout(recoveryHoldTimer.current);
    recoveryHoldTimer.current = window.setTimeout(() => {
      recoveryHoldTimer.current = undefined;
      setKeepComputerRecovery(false);
    }, 4000);
  }, []);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (!showComputer && section === "computer") setSection("general");
  }, [showComputer, section]);

  useEffect(() => {
    if (!billingEnabled && section === "billing") setSection("general");
  }, [billingEnabled, section]);

  useEffect(() => {
    if (!showUpdates && !serverUpdate.loading && section === "updates") setSection("general");
  }, [showUpdates, serverUpdate.loading, section]);

  useEffect(() => {
    if (section !== "computer") releaseComputerRecovery();
  }, [section, releaseComputerRecovery]);
  useEffect(() => () => window.clearTimeout(recoveryHoldTimer.current), []);

  useEffect(() => {
    if (section === "usage") {
      onUsageOpen();
      usageRef.current?.focus();
    }
  }, [section, onUsageOpen]);

  const navItems: NavItem[] = [
    { id: "general", label: t`General`, icon: Settings },
    { id: "models", label: t`Models`, icon: Cpu },
    { id: "memory", label: t`Memory`, icon: Brain },
    { id: "voice", label: t`Voice`, icon: Volume2 },
    { id: "confirmations", label: t`Confirmations`, icon: ShieldCheck },
    { id: "usage", label: t`Usage`, icon: Gauge },
    ...(showComputer ? [{ id: "computer" as const, label: t`Computer`, icon: Monitor }] : []),
    ...(billingEnabled ? [{ id: "billing" as const, label: t`Billing`, icon: CreditCard }] : []),
    ...(showUpdates ? [{ id: "updates" as const, label: t`Updates`, icon: CloudDownload }] : []),
  ];

  const passkeysSupported = usePasskeysSupported();
  const desktopSettings = desktopBridge()?.settings;
  const openServerSettings = desktopSettings ? () => void desktopSettings.openServer() : undefined;
  const settingItems: (SettingsSearchItem<SettingsSection> & { available?: boolean })[] = [
    {
      section: "general",
      target: "account",
      label: t`Account`,
      keywords: ["profile", "email", "name", "sso", "security", "password", "sign in"],
    },
    {
      section: "general",
      target: "passkeys",
      label: t`Passkeys`,
      keywords: ["webauthn", "touch id", "face id", "security key"],
      available: passkeysSupported,
    },
    {
      section: "general",
      target: "messaging",
      label: t`Messaging`,
      keywords: ["sms", "text", "chat apps", "channels"],
      available: messagingEnabled && Boolean(onOpenMessaging),
    },
    {
      section: "general",
      target: "theme",
      label: t`Theme`,
      keywords: ["appearance", "dark mode", "light mode", "color scheme", "system"],
    },
    {
      section: "general",
      target: "sidebar-density",
      label: t`Sidebar density`,
      keywords: ["compact", "comfortable", "spacing"],
    },
    {
      section: "general",
      target: "avatars",
      label: t`Avatars`,
      keywords: ["robot", "organic", "bot icons"],
    },
    {
      section: "general",
      target: "language",
      label: t`Language`,
      keywords: ["locale", "translation", "region"],
    },
    {
      section: "general",
      target: "timezone",
      label: t`Timezone`,
      keywords: ["time zone", "clock", "region"],
    },
    {
      section: "general",
      target: "server-settings",
      label: t`Server settings`,
      keywords: ["host", "local server", "backend", "connection"],
      available: Boolean(openServerSettings),
    },
    {
      section: "general",
      target: "server-integrations",
      label: t`Server integrations`,
      keywords: ["connectors", "apps", "oauth"],
      available: isDeploymentOwner,
    },
    {
      section: "general",
      target: "send-with-enter",
      label: t`Send with Enter`,
      keywords: ["keyboard", "return", "shortcut", "composer", "newline"],
    },
    {
      section: "general",
      target: "stream-replies",
      label: t`Stream replies`,
      keywords: ["streaming", "typing", "live"],
    },
    {
      section: "general",
      target: "tool-activity",
      label: t`Show tool activity`,
      keywords: ["tools", "steps", "details"],
    },
    {
      section: "general",
      target: "remote-images",
      label: t`Load web images automatically`,
      keywords: ["remote images", "pictures", "privacy", "tracking"],
    },
    {
      section: "general",
      target: "delete-account",
      label: t`Delete account`,
      keywords: ["remove", "close account", "erase", "data"],
    },
    {
      section: "models",
      target: "active-model",
      label: t`Active model`,
      keywords: ["default model", "thinking"],
    },
    {
      section: "models",
      target: "model-providers",
      label: t`Model providers`,
      keywords: [
        "api key",
        "sign in",
        "subscription",
        "compatible",
        "local",
        "base url",
        "credentials",
      ],
    },
    {
      section: "models",
      target: "backup-models",
      label: t`Backup models`,
      keywords: ["fallback", "failover", "retry"],
    },
    {
      section: "memory",
      target: "memory-provider",
      label: t`Memory provider`,
      keywords: ["connect", "api key", ...MEMORY_PROVIDER_SETTINGS.map((entry) => entry.name)],
    },
    {
      section: "memory",
      target: "memory-scope",
      label: t`Default scope`,
      keywords: ["isolated", "shared", "memory scope"],
    },
    {
      section: "memory",
      target: "shared-documents",
      label: t`Shared documents`,
      keywords: ["knowledge", "notes", "files", "export"],
    },
    {
      section: "voice",
      target: "voice-providers",
      label: t`Voice providers`,
      keywords: ["text to speech", "transcription", "stt", "tts", "api key"],
    },
    {
      section: "confirmations",
      target: "auto-review",
      label: t`Flag unexpected actions`,
      keywords: ["auto review", "risky", "safety"],
    },
    {
      section: "confirmations",
      target: "approval-rules",
      label: t`Approval rules`,
      keywords: ["ask before", "email", "purchase", "allow"],
    },
    {
      section: "updates",
      target: "desktop-update",
      label: t`Desktop app`,
      keywords: ["version", "restart", "check for updates"],
      available: Boolean(desktopBridge()?.update),
    },
    {
      section: "updates",
      target: "server-update",
      label: t`Software update`,
      keywords: ["server", "version", "check for updates"],
      available: hasServerUpdates(serverUpdate),
    },
  ];
  const availableSections = new Set(navItems.map((item) => item.id));
  const searchItems: SettingsSearchItem<SettingsSection>[] = [
    ...navItems.map((item) => ({
      section: item.id,
      label: item.label,
      keywords: SECTION_KEYWORDS[item.id],
    })),
    ...settingItems.filter(
      ({ section: itemSection, available = true }) =>
        available && availableSections.has(itemSection),
    ),
  ];
  const results = searchSettings(searchItems, query);
  useEffect(() => {
    if (!query.trim()) return;
    document.getElementById(`${resultsId}-${activeResult}`)?.scrollIntoView?.({
      block: "nearest",
    });
  }, [activeResult, query, resultsId]);
  const sectionLabel = (id: SettingsSection) =>
    navItems.find((item) => item.id === id)?.label ?? id;

  function openResult(result: SettingsSearchItem<SettingsSection>) {
    if (panelBusy) return;
    setQuery("");
    setActiveResult(0);
    setSection(result.section);
    setReveal(result.target ? { target: result.target } : null);
  }

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const offset = Math.abs(nav.scrollLeft);
      setNavOverflow({
        previous: offset > 1,
        next: nav.scrollWidth - nav.clientWidth - offset > 1,
      });
    };
    const revealSection = () => {
      if (nav.scrollWidth > nav.clientWidth) {
        nav.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({
          block: "nearest",
          inline: "nearest",
        });
      }
      measure();
    };
    revealSection();
    nav.addEventListener("scroll", measure);
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(revealSection);
    observer?.observe(nav);
    return () => {
      nav.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [section, showComputer, billingEnabled, showUpdates, i18n.locale, query]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!reveal || !container) return;
    const selector = `#${settingsTargetId(reveal.target)}`;
    let highlighted: HTMLElement | null = null;
    let highlightTimer: number | undefined;
    let observer: MutationObserver | undefined;
    let giveUpTimer: number | undefined;
    const stopWaiting = () => {
      observer?.disconnect();
      window.clearTimeout(giveUpTimer);
    };
    // Panels load asynchronously and Advanced folds open first, so wait for a visible target.
    const attempt = () => {
      const element = container.querySelector<HTMLElement>(selector);
      if (!element || element.closest("[hidden]")) return false;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView?.({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      const control =
        element.tagName === "SECTION" ? null : element.querySelector<HTMLElement>(FOCUSABLE);
      if (control) {
        control.focus({ preventScroll: true });
      } else {
        element.tabIndex = -1;
        element.focus({ preventScroll: true });
      }
      element.setAttribute("data-highlighted", "");
      highlighted = element;
      highlightTimer = window.setTimeout(
        () => element.removeAttribute("data-highlighted"),
        REVEAL_HIGHLIGHT_MS,
      );
      return true;
    };
    if (!attempt()) {
      observer = new MutationObserver(() => {
        if (attempt()) stopWaiting();
      });
      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden"],
      });
      giveUpTimer = window.setTimeout(stopWaiting, REVEAL_TIMEOUT_MS);
    }
    return () => {
      stopWaiting();
      window.clearTimeout(highlightTimer);
      highlighted?.removeAttribute("data-highlighted");
    };
  }, [reveal]);

  function scrollSections(direction: number) {
    const nav = navRef.current;
    if (!nav) return;
    const rtl = getComputedStyle(nav).direction === "rtl";
    nav.scrollBy({ left: nav.clientWidth * 0.75 * direction * (rtl ? -1 : 1), behavior: "smooth" });
  }

  const sectionTitle =
    navItems.find((item) => item.id === section)?.label ??
    (section === "general" ? t`General` : t`Settings`);

  const closeLabel =
    section === "models"
      ? t`Close model settings`
      : section === "memory"
        ? t`Close memory settings`
        : section === "voice"
          ? t`Close voice settings`
          : t`Close user settings`;

  async function refreshVoiceStatus() {
    await onVoiceStatusMaybeChanged?.();
  }

  function leaveSettings(next: () => void) {
    if (panelBusy) return;
    void refreshVoiceStatus().finally(next);
  }

  function requestClose() {
    leaveSettings(onClose);
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape-key" && query) {
          details.cancel();
          setQuery("");
          return;
        }
        if (panelBusy) {
          details.cancel();
          return;
        }
        requestClose();
      }}
    >
      <DialogContent
        ref={panelRef}
        data-testid="user-settings"
        data-settings-section={section}
        showCloseButton={false}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            searchRef.current?.focus();
            searchRef.current?.select();
          }
        }}
        initialFocus={() =>
          section === "usage" ? (usageRef.current ?? panelRef.current) : panelRef.current
        }
        className="flex h-[min(760px,calc(100%-2rem))] max-h-[calc(100%-2rem)] w-[min(1080px,calc(100%-2rem))] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[calc(100%-5rem)] sm:max-w-[1080px]"
      >
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="flex shrink-0 flex-col border-b border-border md:min-h-0 md:w-[220px] md:border-e md:border-b-0">
            <div className="relative mx-3 mt-3 md:mt-4">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={searchRef}
                type="search"
                data-testid="settings-search"
                role="combobox"
                aria-label={t`Search settings`}
                aria-expanded={query.trim() !== ""}
                aria-controls={resultsId}
                aria-autocomplete="list"
                aria-activedescendant={
                  results.length > 0 ? `${resultsId}-${activeResult}` : undefined
                }
                placeholder={t`Search`}
                autoComplete="off"
                spellCheck={false}
                value={query}
                disabled={panelBusy}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveResult(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    if (results.length === 0) return;
                    event.preventDefault();
                    const step = event.key === "ArrowDown" ? 1 : -1;
                    setActiveResult((index) => (index + step + results.length) % results.length);
                  } else if (event.key === "Enter") {
                    const result = results[activeResult];
                    if (!result) return;
                    event.preventDefault();
                    openResult(result);
                  } else if (event.key === "Escape" && query) {
                    event.preventDefault();
                    event.stopPropagation();
                    setQuery("");
                  }
                }}
                className="h-8 ps-7 text-[13px] [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
            {query.trim() ? (
              <div
                id={resultsId}
                role="listbox"
                aria-label={t`Settings results`}
                data-testid="settings-search-results"
                className="rk-scroll flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto p-3 md:max-h-none md:min-h-0 md:flex-1"
              >
                {results.length === 0 ? (
                  <p role="status" className="px-2.5 py-2 text-[13px] text-muted-foreground">
                    {t`No results`}
                  </p>
                ) : (
                  results.map((result, index) => (
                    <div
                      key={`${result.section}:${result.target ?? ""}:${result.label}`}
                      id={`${resultsId}-${index}`}
                      role="option"
                      aria-selected={index === activeResult}
                      tabIndex={-1}
                      onPointerMove={() => setActiveResult(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openResult(result)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") openResult(result);
                      }}
                      className={`flex cursor-default items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-[13.5px] ${
                        index === activeResult
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span className="min-w-0 truncate text-foreground">{result.label}</span>
                      {result.target ? (
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          {sectionLabel(result.section)}
                        </span>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1 px-3 md:block md:min-h-0 md:flex-1 md:overflow-y-auto md:px-0">
                {/* Reserve arrow space so showing controls does not change the overflow measurement. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={`shrink-0 md:hidden ${navOverflow.previous || navOverflow.next ? "" : "invisible"}`}
                  aria-label={t`Previous settings sections`}
                  disabled={!navOverflow.previous || panelBusy}
                  onClick={() => scrollSections(-1)}
                >
                  <ChevronLeft className="rtl:rotate-180" />
                </Button>
                <nav
                  ref={navRef}
                  data-testid="settings-nav"
                  aria-label={t`Settings`}
                  className="flex min-w-0 flex-1 flex-row gap-1 overflow-x-auto py-2 md:flex-col md:overflow-visible md:px-3 md:py-3"
                >
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const active = item.id === section;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`settings-nav-${item.id}`}
                        aria-current={active ? "page" : undefined}
                        disabled={panelBusy}
                        onClick={() => {
                          setReveal(null);
                          setSection(item.id);
                        }}
                        className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-start text-[13.5px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
                          active
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                        <span className="whitespace-nowrap">{item.label}</span>
                      </button>
                    );
                  })}
                </nav>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={`shrink-0 md:hidden ${navOverflow.previous || navOverflow.next ? "" : "invisible"}`}
                  aria-label={t`Next settings sections`}
                  disabled={!navOverflow.next || panelBusy}
                  onClick={() => scrollSections(1)}
                >
                  <ChevronRight className="rtl:rotate-180" />
                </Button>
              </div>
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              data-testid="settings-header"
              className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 pb-5 pt-6 sm:px-8 sm:pt-7"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <DialogTitle className="text-2xl font-medium text-foreground">
                  {sectionTitle}
                </DialogTitle>
                {!spaceScoped ? null : space && spaces.length > 1 && onSpaceChange ? (
                  <OptionSelect
                    className="w-56"
                    data-testid="settings-space"
                    aria-label={t`Space`}
                    options={spaces.map((option) => ({ value: option.id, label: option.name }))}
                    value={space.id}
                    disabled={panelBusy}
                    onValueChange={(next) => {
                      if (next !== space.id) leaveSettings(() => onSpaceChange(next));
                    }}
                  />
                ) : space ? (
                  <p data-testid="settings-space" className="text-sm text-muted-foreground">
                    {space.name}
                  </p>
                ) : null}
              </div>
              <DialogClose
                aria-label={closeLabel}
                disabled={panelBusy}
                render={<Button variant="ghost" size="icon-sm" />}
              >
                <XIcon />
              </DialogClose>
            </div>

            <SpaceRpcProvider spaceId={spaceId}>
              <div
                key={spaceId ?? "selected"}
                ref={scrollRef}
                data-testid="settings-scroll"
                className={`min-h-0 flex-1 ${
                  section === "models" || section === "voice" || section === "memory"
                    ? "flex flex-col overflow-hidden"
                    : "rk-scroll overflow-y-auto overscroll-contain px-6 pb-6 pt-6 sm:px-8 sm:pb-8"
                }`}
              >
                {section === "general" ? (
                  <GeneralSettingsPanels
                    email={email}
                    name={name}
                    avatarStyle={avatarStyle}
                    onAvatarStyleChange={onAvatarStyleChange}
                    timezone={timezone}
                    onTimezoneChange={onTimezoneChange}
                    messagingEnabled={messagingEnabled}
                    onOpenMessaging={
                      onOpenMessaging ? () => leaveSettings(onOpenMessaging) : undefined
                    }
                    isDeploymentOwner={isDeploymentOwner}
                    onOpenServerSettings={openServerSettings}
                    revealTarget={reveal?.target ?? null}
                  />
                ) : null}
                {section === "confirmations" ? <ApprovalRulesSettings /> : null}
                {section === "usage" ? (
                  <UsageSettingsPanel usage={usage} panelRef={usageRef} />
                ) : null}
                {section === "computer" && showComputer ? (
                  <ComputerSettingsPanel
                    sandboxProvider={sandboxProvider}
                    onSandboxProviderChange={(next) => {
                      onSandboxProviderChange?.(next);
                      holdComputerRecovery();
                    }}
                    onRecoveryDismissed={releaseComputerRecovery}
                  />
                ) : null}
                {section === "billing" && billingEnabled ? <BillingSettingsPanel /> : null}
                {section === "updates" && showUpdates ? (
                  <UpdatesSettingsPanel serverUpdate={serverUpdate} />
                ) : null}
                {section === "models" ? (
                  <ModelSettingsOverlay embedded onClose={requestClose} />
                ) : null}
                {section === "memory" && otherSpace && otherMemoryError ? (
                  <div className="px-6 py-6 sm:px-8">
                    <p className="mb-4 text-sm text-destructive">{otherMemoryError}</p>
                    <Button
                      variant="outline"
                      onClick={() => setMemoryLoadAttempt((attempt) => attempt + 1)}
                    >
                      {t`Retry`}
                    </Button>
                  </div>
                ) : section === "memory" ? (
                  <MemorySettingsOverlay
                    embedded
                    onClose={requestClose}
                    config={otherSpace ? otherMemoryConfig : memoryConfig}
                    onConfigChange={otherSpace ? setOtherMemoryConfig : onMemoryConfigChange}
                    onBusyChange={setMemoryBusy}
                  />
                ) : null}
                {section === "voice" ? (
                  <VoiceSettingsOverlay
                    embedded
                    onClose={requestClose}
                    onBusyChange={setVoiceBusy}
                  />
                ) : null}
              </div>
            </SpaceRpcProvider>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
