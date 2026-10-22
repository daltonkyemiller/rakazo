import { Trans, useLingui } from "@lingui/react/macro";
import type { AccountSecurity, AvatarStyle } from "@rakazo/contracts";
import { accountDisplay, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@rakazo/core";
import {
  BotAvatar,
  Button,
  buttonVariants,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  OptionSelect,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo/ui-web";
import { Disclosure } from "@rakazo/ui-web/components/ui/disclosure";
import type { RefObject } from "react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { AccountAccess } from "../components/AccountAccess";
import { SuccessPop } from "../components/ai/primitives";
import { ComputersUnavailableHint } from "../components/ComputersUnavailableHint";
import { DesktopUpdateSection } from "../components/DesktopUpdates";
import { PasskeySettings } from "../components/PasskeySettings";
import {
  SettingsRow,
  SettingsSection,
  SettingsStack,
  segmentedGroupClass,
  segmentedItemClass,
} from "../components/SettingsLayout";
import type { ServerUpdateLoad } from "../components/SoftwareUpdateSection";
import { hasServerUpdates, SoftwareUpdateSection } from "../components/SoftwareUpdateSection";
import { authClient } from "../lib/auth";
import type { BotsSidebarDensity } from "../lib/bots-sidebar-density-pref";
import {
  getBotsSidebarDensity,
  setBotsSidebarDensity,
  subscribeBotsSidebarDensity,
} from "../lib/bots-sidebar-density-pref";
import {
  getComposerEnterToSend,
  setComposerEnterToSend,
  subscribeComposerEnterToSend,
} from "../lib/composer-enter-to-send-pref";
import { getActiveUiLocale, setUiLocale } from "../lib/i18n";
import { localTimezone, sameTimeZone, timezoneOptions } from "../lib/local-timezone";
import {
  getRemoteImagesPreference,
  setRemoteImagesPreference,
} from "../lib/remote-images-preference";
import {
  getResponseStreamingPreference,
  setResponseStreamingPreference,
} from "../lib/response-streaming";
import {
  getToolActivityPreference,
  setToolActivityPreference,
} from "../lib/tool-activity-preference";
import type { AppearancePreference } from "../lib/ui-appearance";
import { getUiAppearancePreference, setUiAppearance } from "../lib/ui-appearance";
import type { UiLocale } from "../lib/ui-locale";
import { UI_LOCALE_LABELS, UI_LOCALES } from "../lib/ui-locale";
import { authErrorText } from "../lib/user-error";

export type SettingsGeneralProps = {
  email?: string | null;
  name: string;
  avatarStyle: AvatarStyle;
  onAvatarStyleChange: (style: AvatarStyle) => Promise<void>;
  /** The user's saved IANA timezone, or null before one is set. */
  timezone?: string | null;
  onTimezoneChange?: (timezone: string) => Promise<void>;
  messagingEnabled?: boolean;
  onOpenMessaging?: () => void;
  isDeploymentOwner?: boolean;
  /** Opens the desktop app's native server window; absent outside the desktop app. */
  onOpenServerSettings?: () => void;
  /** A search result to reveal; Advanced opens when the target lives inside it. */
  revealTarget?: string | null;
};

const ADVANCED_TARGETS: ReadonlySet<string> = new Set([
  "send-with-enter",
  "stream-replies",
  "tool-activity",
  "remote-images",
]);

export function GeneralSettingsPanels({
  email,
  name,
  avatarStyle,
  onAvatarStyleChange,
  timezone = null,
  onTimezoneChange,
  messagingEnabled = false,
  onOpenMessaging,
  isDeploymentOwner = false,
  onOpenServerSettings,
  revealTarget = null,
}: SettingsGeneralProps) {
  const { t } = useLingui();
  const account = accountDisplay({ name, email }, t`You`);
  const [accountSecurity, setAccountSecurity] = useState<AccountSecurity | null>(null);
  const [locale, setLocale] = useState<UiLocale>(() => getActiveUiLocale());
  const localeRequestRef = useRef(0);
  const [appearance, setAppearance] = useState<AppearancePreference>(() =>
    getUiAppearancePreference(),
  );
  const sidebarDensity = useSyncExternalStore(
    subscribeBotsSidebarDensity,
    getBotsSidebarDensity,
    () => "comfortable",
  );
  const sidebarDensityLabelId = useId();
  const appearanceLabelId = useId();
  const avatarLabelId = useId();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    if (revealTarget && ADVANCED_TARGETS.has(revealTarget)) setAdvancedOpen(true);
  }, [revealTarget]);
  const [streamReplies, setStreamReplies] = useState(
    () => getResponseStreamingPreference() === "on",
  );
  const streamRepliesId = useId();
  const [showToolActivity, setShowToolActivity] = useState(
    () => getToolActivityPreference() === "on",
  );
  const showToolActivityId = useId();
  const enterToSend = useSyncExternalStore(
    subscribeComposerEnterToSend,
    getComposerEnterToSend,
    () => false,
  );
  const enterToSendId = useId();
  const [loadRemoteImages, setLoadRemoteImages] = useState(
    () => getRemoteImagesPreference() === "on",
  );
  const loadRemoteImagesId = useId();
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const timezoneId = useId();
  const [timezonePending, setTimezonePending] = useState(false);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const deviceTimezone = localTimezone();

  function chooseLocale(next: UiLocale) {
    if (next === locale) return;
    const requestId = ++localeRequestRef.current;
    setLocale(next);
    void setUiLocale(next).then((activated) => {
      if (requestId !== localeRequestRef.current) return;
      setLocale(activated);
    });
  }

  async function chooseAvatarStyle(next: AvatarStyle) {
    if (avatarPending || next === avatarStyle) return;
    setAvatarPending(true);
    setAvatarError(null);
    try {
      await onAvatarStyleChange(next);
    } catch {
      setAvatarError(t`Couldn't update avatars`);
    } finally {
      setAvatarPending(false);
    }
  }

  async function chooseTimezone(next: string) {
    if (!onTimezoneChange || timezonePending || next === timezone) return;
    setTimezonePending(true);
    setTimezoneError(null);
    try {
      await onTimezoneChange(next);
    } catch {
      setTimezoneError(t`Couldn't update your timezone`);
    } finally {
      setTimezonePending(false);
    }
  }

  return (
    <SettingsStack>
      <SettingsSection title={<Trans>Account</Trans>} target="account">
        <SettingsRow
          label={<span dir="auto">{account.label}</span>}
          description={email && account.label !== email ? email : undefined}
        />
        {accountSecurity?.hasPassword && accountSecurity.passwordChangeEnabled !== false ? (
          <ChangePasswordRow email={email} />
        ) : null}
        <PasskeySettings />
        {messagingEnabled && onOpenMessaging ? (
          <SettingsRow label={<Trans>Messaging</Trans>} target="messaging">
            <Button variant="outline" size="sm" onClick={onOpenMessaging}>
              <Trans>Manage messaging settings</Trans>
            </Button>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <SettingsSection title={<Trans>Appearance</Trans>}>
        <SettingsRow label={<Trans>Theme</Trans>} labelId={appearanceLabelId} target="theme">
          <AppearancePicker
            labelledBy={appearanceLabelId}
            value={appearance}
            onChange={(next) => {
              setAppearance(next);
              setUiAppearance(next);
            }}
          />
        </SettingsRow>
        <SettingsRow
          label={<Trans>Sidebar density</Trans>}
          labelId={sidebarDensityLabelId}
          target="sidebar-density"
        >
          <ToggleGroup
            aria-labelledby={sidebarDensityLabelId}
            data-testid="bots-sidebar-density-select"
            value={[sidebarDensity]}
            onValueChange={([next]) => {
              if (next) setBotsSidebarDensity(next as BotsSidebarDensity);
            }}
            spacing={1}
            className={`${segmentedGroupClass} w-full grid-cols-2 sm:w-56`}
          >
            <ToggleGroupItem
              value="comfortable"
              data-testid="bots-sidebar-density-comfortable"
              className={segmentedItemClass}
            >
              <Trans>Comfortable</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="compact"
              data-testid="bots-sidebar-density-compact"
              className={segmentedItemClass}
            >
              <Trans>Compact</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
        <SettingsRow
          label={<Trans>Avatars</Trans>}
          labelId={avatarLabelId}
          target="avatars"
          testId="avatar-style-select"
          description={
            avatarError ? (
              <span role="alert" className="text-destructive">
                {avatarError}
              </span>
            ) : undefined
          }
        >
          <ToggleGroup
            aria-labelledby={avatarLabelId}
            value={[avatarStyle]}
            onValueChange={([next]) => {
              if (next) void chooseAvatarStyle(next as AvatarStyle);
            }}
            disabled={avatarPending}
            spacing={1}
            className={`${segmentedGroupClass} w-full grid-cols-2 sm:w-56`}
          >
            {(["robot", "organic"] as const).map((style) => (
              <ToggleGroupItem
                key={style}
                value={style}
                data-testid={`avatar-style-${style}`}
                className={`${segmentedItemClass} gap-1.5`}
              >
                <BotAvatar
                  color="#D9508A"
                  identity="avatar-style-preview"
                  size={18}
                  variant={style}
                />
                {style === "robot" ? <Trans>Robot</Trans> : <Trans>Organic</Trans>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={<Trans>Language and region</Trans>}>
        <SettingsRow label={<Trans>Language</Trans>} target="language">
          <UiLocalePicker value={locale} onChange={chooseLocale} />
        </SettingsRow>
        {onTimezoneChange ? (
          <SettingsRow
            label={<Trans>Timezone</Trans>}
            labelFor={timezoneId}
            target="timezone"
            testId="timezone-settings"
            description={
              timezoneError ? (
                <span role="alert" className="text-destructive">
                  {timezoneError}
                </span>
              ) : !timezone || !sameTimeZone(timezone, deviceTimezone) ? (
                <Button
                  variant="text"
                  size="xs"
                  className="h-auto max-w-full text-start text-[12.5px] font-normal whitespace-normal"
                  disabled={timezonePending}
                  data-testid="timezone-use-device"
                  onClick={() => void chooseTimezone(deviceTimezone)}
                >
                  <Trans comment="Switches the saved timezone to this device's, e.g. 'Use Pacific/Auckland'">
                    Use {deviceTimezone.replaceAll("_", " ")}
                  </Trans>
                </Button>
              ) : undefined
            }
          >
            <NativeSelect
              id={timezoneId}
              data-testid="timezone-select"
              value={timezone ?? deviceTimezone}
              disabled={timezonePending}
              onChange={(event) => void chooseTimezone(event.target.value)}
              className="w-full sm:w-56"
            >
              {timezoneOptions(timezone ?? deviceTimezone).map((zone) => (
                <NativeSelectOption key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </SettingsRow>
        ) : null}
      </SettingsSection>

      {onOpenServerSettings || isDeploymentOwner ? (
        <SettingsSection title={<Trans>Server</Trans>}>
          {onOpenServerSettings ? (
            <SettingsRow label={<Trans>Server settings</Trans>} target="server-settings">
              <Button
                variant="outline"
                size="sm"
                aria-label={t`Server settings`}
                onClick={onOpenServerSettings}
              >
                <Trans>Open</Trans>
              </Button>
            </SettingsRow>
          ) : null}
          {isDeploymentOwner ? (
            <SettingsRow label={<Trans>Server integrations</Trans>} target="server-integrations">
              <Link
                to="/integrations/setup"
                aria-label={t`Server integrations`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Trans>Open</Trans>
              </Link>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}

      <Disclosure
        data-testid="advanced-settings"
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        summary={<Trans>Advanced</Trans>}
        summaryClassName="text-[13px] font-medium text-muted-foreground hover:text-foreground"
        contentClassName="divide-y divide-border pt-1"
      >
        <SettingsRow
          label={<Trans>Send with Enter</Trans>}
          labelFor={enterToSendId}
          target="send-with-enter"
        >
          <Switch
            id={enterToSendId}
            data-testid="composer-enter-to-send-toggle"
            checked={enterToSend}
            onCheckedChange={(checked) => setComposerEnterToSend(checked)}
          />
        </SettingsRow>
        <SettingsRow
          label={<Trans>Stream replies</Trans>}
          labelFor={streamRepliesId}
          target="stream-replies"
        >
          <Switch
            id={streamRepliesId}
            data-testid="response-streaming-toggle"
            checked={streamReplies}
            onCheckedChange={(checked) => {
              setStreamReplies(checked);
              setResponseStreamingPreference(checked ? "on" : "off");
            }}
          />
        </SettingsRow>
        <SettingsRow
          label={<Trans>Show tool activity</Trans>}
          labelFor={showToolActivityId}
          target="tool-activity"
        >
          <Switch
            id={showToolActivityId}
            data-testid="tool-activity-toggle"
            checked={showToolActivity}
            onCheckedChange={(checked) => {
              setShowToolActivity(checked);
              setToolActivityPreference(checked ? "on" : "off");
            }}
          />
        </SettingsRow>
        <SettingsRow
          label={<Trans>Load web images automatically</Trans>}
          labelFor={loadRemoteImagesId}
          target="remote-images"
        >
          <Switch
            id={loadRemoteImagesId}
            data-testid="remote-images-toggle"
            checked={loadRemoteImages}
            onCheckedChange={(checked) => {
              setLoadRemoteImages(checked);
              setRemoteImagesPreference(checked ? "on" : "off");
            }}
          />
        </SettingsRow>
      </Disclosure>

      <SettingsSection target="delete-account">
        <AccountAccess onSecurity={setAccountSecurity} />
      </SettingsSection>
    </SettingsStack>
  );
}

export function UsageSettingsPanel({
  usage,
  panelRef,
}: {
  usage?: {
    runs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens?: number | null;
  } | null;
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={panelRef} tabIndex={-1} data-testid="usage-settings" className="outline-none">
      <SettingsStack>
        <SettingsSection>
          <SettingsRow
            label={
              usage ? (
                <span className="tabular-nums">
                  <Trans>
                    {usage.runs} runs · {usage.totalTokens ?? "—"} tokens
                  </Trans>
                </span>
              ) : (
                <Trans>Usage</Trans>
              )
            }
            description={<Trans>Model spend uses your provider keys.</Trans>}
          />
        </SettingsSection>
      </SettingsStack>
    </div>
  );
}

export function ComputerSettingsPanel({
  sandboxProvider,
  onSandboxProviderChange,
  onRecoveryDismissed,
}: {
  sandboxProvider?: string | null;
  onSandboxProviderChange?: (sandboxProvider: string) => void;
  onRecoveryDismissed?: () => void;
}) {
  return (
    <SettingsStack>
      <SettingsSection title={<Trans>Computers</Trans>} testId="computers-setup-settings">
        <ComputersUnavailableHint
          className="py-3 text-[13px] leading-relaxed text-muted-foreground"
          sandboxProvider={sandboxProvider}
          onRecovered={onSandboxProviderChange}
          onRecoveryDismissed={onRecoveryDismissed}
        />
      </SettingsSection>
    </SettingsStack>
  );
}

export function UpdatesSettingsPanel({ serverUpdate }: { serverUpdate: ServerUpdateLoad }) {
  return (
    <SettingsStack>
      <DesktopUpdateSection />
      {hasServerUpdates(serverUpdate) ? <SoftwareUpdateSection load={serverUpdate} /> : null}
    </SettingsStack>
  );
}

function ChangePasswordRow({ email }: { email?: string | null }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changePassword() {
    if (pending) return;
    if (newPassword !== confirmation) {
      setError(t`Passwords do not match`);
      return;
    }
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(authErrorText(result.error, t`Could not change password`));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setSaved(true);
      setOpen(false);
    } catch {
      setError(t`Could not reach the server`);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <SettingsRow label={<Trans>Password</Trans>} target="password">
        {saved ? <SuccessPop label={t`Password updated`} /> : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          <Trans>Change password</Trans>
        </Button>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow label={<Trans>Password</Trans>} target="password" stacked>
      <form
        className="grid max-w-sm gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void changePassword();
        }}
      >
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={email ?? ""}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
        <SettingsPasswordInput
          label={t`Current password`}
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <SettingsPasswordInput
          label={t`New password`}
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
        />
        <SettingsPasswordInput
          label={t`Confirm password`}
          autoComplete="new-password"
          value={confirmation}
          onChange={setConfirmation}
        />
        {error ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending || !currentPassword || !newPassword}>
            {pending ? <Trans>Changing…</Trans> : <Trans>Change password</Trans>}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            <Trans>Cancel</Trans>
          </Button>
        </div>
      </form>
    </SettingsRow>
  );
}

function SettingsPasswordInput({
  label,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        minLength={autoComplete === "new-password" ? MIN_PASSWORD_LENGTH : undefined}
        maxLength={MAX_PASSWORD_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function AppearancePicker({
  labelledBy,
  value,
  onChange,
}: {
  labelledBy: string;
  value: AppearancePreference;
  onChange: (next: AppearancePreference) => void;
}) {
  const { t } = useLingui();
  const options: { value: AppearancePreference; label: string }[] = [
    { value: "system", label: t`System` },
    { value: "light", label: t`Light` },
    { value: "dark", label: t`Dark` },
  ];

  return (
    <ToggleGroup
      aria-labelledby={labelledBy}
      data-testid="ui-appearance-select"
      value={[value]}
      onValueChange={([next]) => {
        if (next) onChange(next as AppearancePreference);
      }}
      spacing={1}
      className={`${segmentedGroupClass} w-full grid-cols-3 sm:w-56`}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          data-testid={`ui-appearance-${option.value}`}
          className={segmentedItemClass}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function UiLocalePicker({
  value,
  onChange,
}: {
  value: UiLocale;
  onChange: (locale: UiLocale) => void;
}) {
  const { t } = useLingui();
  return (
    <OptionSelect
      className="w-full sm:w-56"
      data-testid="ui-locale-select"
      aria-label={t`Language`}
      options={UI_LOCALES.map((code) => ({ value: code, label: UI_LOCALE_LABELS[code] }))}
      value={value}
      onValueChange={onChange}
    />
  );
}
