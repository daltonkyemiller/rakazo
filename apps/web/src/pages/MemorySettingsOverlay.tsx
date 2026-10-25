import { Trans, useLingui } from "@lingui/react/macro";
import type { SpaceMemoryConfig } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo/ui-web";
import { XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  SettingsRow,
  SettingsSection,
  SettingsStack,
  segmentedGroupClass,
  segmentedItemClass,
} from "../components/SettingsLayout";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { SpaceMemorySection } from "./KnowledgeSection";
import {
  defaultMemoryProviderSettings,
  MEMORY_PROVIDER_SETTINGS,
  type MemoryProviderConnectionDraft,
  memoryProviderSettings,
} from "./memory-providers/registry";

function ScopePicker({
  labelledBy,
  value,
  disabled,
  onChange,
}: {
  labelledBy: string;
  value: "isolated" | "shared";
  disabled: boolean;
  onChange: (scope: "isolated" | "shared") => void;
}) {
  return (
    <ToggleGroup
      aria-labelledby={labelledBy}
      value={[value]}
      onValueChange={([next]) => {
        if (next === "isolated" || next === "shared") onChange(next);
      }}
      disabled={disabled}
      spacing={1}
      className={`${segmentedGroupClass} w-full grid-cols-2 sm:w-56`}
    >
      {(["isolated", "shared"] as const).map((option) => (
        <ToggleGroupItem key={option} value={option} className={segmentedItemClass}>
          {option === "isolated" ? <Trans>Isolated</Trans> : <Trans>Shared</Trans>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function MemorySettingsOverlay({
  onClose,
  config,
  onConfigChange,
  embedded = false,
  onBusyChange,
}: {
  onClose: () => void;
  config: SpaceMemoryConfig | null | undefined;
  onConfigChange: (config: SpaceMemoryConfig | null) => void;
  /** Render panel body only for the shared Settings shell. */
  embedded?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const providerSelectId = useId();
  const scopeLabelId = useId();
  const defaultRegistration = defaultMemoryProviderSettings();
  const [selectedProvider, setSelectedProvider] = useState(
    config?.provider ?? defaultRegistration.id,
  );
  const [defaultScope, setDefaultScope] = useState<"isolated" | "shared">(
    config?.defaultMemoryScope ?? "isolated",
  );
  const [pending, setPending] = useState<"connect" | "disconnect" | "scope" | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setSelectedProvider(config.provider);
      setDefaultScope(config.defaultMemoryScope);
      return;
    }
    if (config === null && !memoryProviderSettings(selectedProvider)) {
      setSelectedProvider(defaultRegistration.id);
    }
  }, [config, defaultRegistration.id, selectedProvider]);

  const registration = memoryProviderSettings(config?.provider ?? selectedProvider);
  const busy = pending !== null;

  useEffect(() => {
    return () => onBusyChange?.(false);
  }, [onBusyChange]);

  function markPending(next: "connect" | "disconnect" | "scope" | null) {
    setPending(next);
    onBusyChange?.(next !== null);
  }

  async function connect(draft: MemoryProviderConnectionDraft) {
    if (!registration) return false;
    setError(null);
    markPending("connect");
    try {
      const next = await rpc.memory.connectProvider({
        provider: registration.id,
        ...draft,
        defaultMemoryScope: defaultScope,
      });
      onConfigChange(next);
      return true;
    } catch (err) {
      setError(errorText(err, t`Could not connect ${registration.name}`));
      return false;
    } finally {
      markPending(null);
    }
  }

  async function disconnect() {
    setError(null);
    markPending("disconnect");
    try {
      await rpc.memory.disconnectProvider();
      setAddingProvider(false);
      onConfigChange(null);
    } catch (err) {
      setError(errorText(err, t`Could not disconnect memory provider`));
    } finally {
      markPending(null);
    }
  }

  async function updateDefaultScope(scope: "isolated" | "shared") {
    if (scope === defaultScope) return;
    setError(null);
    markPending("scope");
    try {
      const next = await rpc.memory.setDefaultScope({ defaultMemoryScope: scope });
      onConfigChange(next);
    } catch (err) {
      setError(errorText(err, t`Could not update the default memory scope`));
    } finally {
      markPending(null);
    }
  }

  const body = (
    <>
      {!embedded ? (
        <div className="flex items-start justify-between px-6 pt-6 sm:px-8 sm:pt-7">
          <div>
            <DialogTitle className="text-heading2 font-medium text-foreground">
              <Trans>Memory</Trans>
            </DialogTitle>
          </div>
          <DialogClose
            aria-label={t`Close memory settings`}
            disabled={busy}
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <XIcon />
          </DialogClose>
        </div>
      ) : null}

      <div className="rk-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-6 sm:px-8 sm:pb-8">
        <SettingsStack>
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

          {config === undefined ? (
            <p className="text-[13px] text-muted-foreground">
              <Spinner aria-label={t`Loading memory settings…`} />
            </p>
          ) : config ? (
            <SettingsSection target="memory-provider">
              <SettingsRow
                label={registration?.name ?? config.provider}
                description={registration?.connectedLabel(config) ?? config.provider}
              >
                <span className="text-[12.5px] text-success">
                  <Trans>Connected</Trans>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  {pending === "disconnect" ? (
                    <Trans>Disconnecting…</Trans>
                  ) : (
                    <Trans>Disconnect</Trans>
                  )}
                </Button>
              </SettingsRow>
              <SettingsRow
                label={<Trans>Default scope</Trans>}
                labelId={scopeLabelId}
                target="memory-scope"
              >
                <ScopePicker
                  labelledBy={scopeLabelId}
                  value={defaultScope}
                  disabled={busy}
                  onChange={(scope) => void updateDefaultScope(scope)}
                />
              </SettingsRow>
            </SettingsSection>
          ) : !addingProvider ? (
            <Button variant="outline" onClick={() => setAddingProvider(true)}>
              <Trans>Connect memory provider</Trans>
            </Button>
          ) : registration ? (
            <SettingsSection target="memory-provider">
              <SettingsRow
                label={<Trans>Provider</Trans>}
                labelFor={MEMORY_PROVIDER_SETTINGS.length > 1 ? providerSelectId : undefined}
              >
                {MEMORY_PROVIDER_SETTINGS.length > 1 ? (
                  <NativeSelect
                    id={providerSelectId}
                    className="w-full sm:w-56"
                    value={selectedProvider}
                    disabled={busy}
                    onChange={(event) => setSelectedProvider(event.target.value)}
                  >
                    {MEMORY_PROVIDER_SETTINGS.map((entry) => (
                      <NativeSelectOption key={entry.id} value={entry.id}>
                        {entry.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                ) : (
                  <span className="text-[13.5px] text-foreground">{registration.name}</span>
                )}
              </SettingsRow>
              <SettingsRow
                label={<Trans>Default scope</Trans>}
                labelId={scopeLabelId}
                target="memory-scope"
              >
                <ScopePicker
                  labelledBy={scopeLabelId}
                  value={defaultScope}
                  disabled={busy}
                  onChange={setDefaultScope}
                />
              </SettingsRow>
              <div className="max-w-md pb-3">
                <registration.SettingsForm busy={busy} onConnect={connect} />
              </div>
            </SettingsSection>
          ) : (
            <p className="text-[13px] text-destructive">
              <Trans>The selected memory provider is not available in this build.</Trans>
            </p>
          )}
          <SpaceMemorySection />
        </SettingsStack>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div data-testid="memory-settings" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {body}
      </div>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (busy) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(760px,calc(100%-2rem))] w-[560px] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-h-[min(760px,calc(100%-5rem))] sm:max-w-[calc(100%-5rem)]"
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}
