import { Trans, useLingui } from "@lingui/react/macro";
import type { ComputerResourcesState } from "@rakazo/contracts";
import { ComputerResourceSettingsSchema } from "@rakazo/contracts";
import { Button, Input, OptionSelect, Spinner, Switch } from "@rakazo/ui-web";
import { useEffect, useId, useRef, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { errorText } from "../lib/user-error";
import { SuccessPop } from "./ai/primitives";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

export function ComputerResourcesSettings({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t, i18n } = useLingui();
  const bridge = desktopBridge()?.resources;
  const memoryId = useId();
  const cpuId = useId();
  const existingId = useId();
  const [state, setState] = useState<ComputerResourcesState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState("4");
  const [cpu, setCpu] = useState("4");
  const [advanced, setAdvanced] = useState(false);
  const [existing, setExisting] = useState(true);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const initialized = useRef(false);
  const generation = useRef(0);
  const [reload, setReload] = useState(0);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  useEffect(() => {
    if (!bridge) {
      setLoaded(true);
      return;
    }
    let active = true;
    const read = async () => {
      if (busy.current || document.visibilityState === "hidden") return;
      const request = ++generation.current;
      try {
        const next = await bridge.state();
        if (!active || request !== generation.current) return;
        setState(next);
        if (next && !initialized.current) {
          initialized.current = true;
          setMemory(String(next.defaults.memoryGiB ?? 4));
          setCpu(String(next.defaults.cpuCores ?? 4));
        }
        setLoaded(true);
      } catch (err) {
        if (active && request === generation.current) {
          setError(errorText(err, t`Could not load computer resources`));
          setLoaded(true);
        }
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 10_000);
    document.addEventListener("visibilitychange", read);
    return () => {
      active = false;
      generation.current += 1;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [bridge, reload, t]);

  const number = (value: number) =>
    new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(value);
  const memoryLabel = (value: number | null) =>
    value === null ? t`Unlimited` : t`${number(value)} GB`;
  const cpuLabel = (value: number | null) =>
    value === null ? t`Unlimited` : t`${number(value)} cores`;
  const choices = [
    { value: "2:2", label: t`2 GB / 2 cores`, memory: 2, cpu: 2 },
    { value: "4:4", label: t`4 GB / 4 cores`, memory: 4, cpu: 4 },
    { value: "8:4", label: t`8 GB / 4 cores`, memory: 8, cpu: 4 },
  ].filter(
    (choice) =>
      !state ||
      (choice.memory <= state.capacity.memoryGiB && choice.cpu <= state.capacity.cpuCores),
  );
  const selected =
    advanced || !choices.some((choice) => choice.value === `${memory}:${cpu}`)
      ? "custom"
      : `${memory}:${cpu}`;
  const changed =
    state &&
    (Number(memory) !== state.defaults.memoryGiB || Number(cpu) !== state.defaults.cpuCores);
  const existingChanged =
    existing &&
    state?.computers.some(
      (computer) =>
        computer.limits.memoryGiB !== Number(memory) || computer.limits.cpuCores !== Number(cpu),
    );

  async function apply() {
    if (!bridge || busy.current) return;
    const parsed = ComputerResourceSettingsSchema.safeParse({
      memoryGiB: Number(memory),
      cpuCores: Number(cpu),
      applyToExisting: existing,
    });
    if (!parsed.success) {
      setError(t`Choose valid memory and CPU limits.`);
      return;
    }
    busy.current = true;
    generation.current += 1;
    setPending(true);
    onBusyChange?.(true);
    setSaved(false);
    setError(null);
    try {
      setState(await bridge.apply(parsed.data));
      setSaved(true);
    } catch (err) {
      setError(errorText(err, t`Could not update computer resources`));
    } finally {
      busy.current = false;
      setPending(false);
      onBusyChange?.(false);
      setReload((value) => value + 1);
    }
  }

  if (!loaded)
    return (
      <div role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        <Trans>Loading resources…</Trans>
      </div>
    );
  if (!state)
    return (
      <div className="py-3 text-sm text-muted-foreground">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setError(null);
                setReload((value) => value + 1);
              }}
            >
              <Trans>Retry</Trans>
            </Button>
          </>
        ) : (
          <Trans>Manage resources in Rakazo on the computer hosting this server.</Trans>
        )}
      </div>
    );

  return (
    <div data-testid="computer-resources-settings" className="space-y-7">
      <SettingsSection title={<Trans>Capacity</Trans>}>
        <SettingsRow
          label={<Trans>Available to Docker</Trans>}
          description={<Trans>Shared by computers and other containers.</Trans>}
        >
          <span className="text-sm tabular-nums">
            {memoryLabel(state.capacity.memoryGiB)} / {cpuLabel(state.capacity.cpuCores)}
          </span>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={<Trans>Default limits</Trans>} target="computer-resources">
        <SettingsRow
          label={<Trans>Per computer</Trans>}
          description={<Trans>For new computers. Shared computers serve multiple bots.</Trans>}
        >
          <OptionSelect
            aria-label={t`Computer resource preset`}
            value={selected}
            disabled={pending}
            onValueChange={(value) => {
              setSaved(false);
              setAdvanced(value === "custom");
              const choice = choices.find((choice) => choice.value === value);
              if (choice) {
                setMemory(String(choice.memory));
                setCpu(String(choice.cpu));
              }
            }}
            options={[
              ...choices.map(({ value, label }) => ({ value, label })),
              { value: "custom", label: t`Custom…` },
            ]}
          />
        </SettingsRow>
        {selected === "custom" ? (
          <>
            <SettingsRow label={<Trans>Memory (GB)</Trans>} labelFor={memoryId}>
              <Input
                id={memoryId}
                type="number"
                inputMode="decimal"
                className="w-28"
                min={0.5}
                max={state.capacity.memoryGiB}
                step={0.25}
                value={memory}
                disabled={pending}
                onChange={(event) => {
                  setMemory(event.target.value);
                  setSaved(false);
                }}
              />
            </SettingsRow>
            <SettingsRow label={<Trans>CPU cores</Trans>} labelFor={cpuId}>
              <Input
                id={cpuId}
                type="number"
                inputMode="decimal"
                className="w-28"
                min={0.5}
                max={state.capacity.cpuCores}
                step={0.5}
                value={cpu}
                disabled={pending}
                onChange={(event) => {
                  setCpu(event.target.value);
                  setSaved(false);
                }}
              />
            </SettingsRow>
          </>
        ) : null}
        {state.computers.length ? (
          <SettingsRow
            label={<Trans>Apply to existing computers</Trans>}
            labelFor={existingId}
            description={<Trans>Computers stay running; views may briefly reconnect.</Trans>}
          >
            <Switch
              id={existingId}
              checked={existing}
              disabled={pending}
              onCheckedChange={setExisting}
            />
          </SettingsRow>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3 py-3">
          {saved ? <SuccessPop label={t`Resources updated`} /> : null}
          <Button disabled={pending || (!changed && !existingChanged)} onClick={() => void apply()}>
            {pending ? <Trans>Applying…</Trans> : <Trans>Apply limits</Trans>}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="pb-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </SettingsSection>
      {state.computers.length ? (
        <SettingsSection title={<Trans>Computers</Trans>}>
          {state.computers.map((computer, index) => (
            <SettingsRow
              key={computer.id}
              label={computer.shared ? t`Shared computer` : t`Computer ${index + 1}`}
              stacked
              description={
                computer.memoryKilled ? (
                  <span className="text-warning">
                    <Trans>Memory limit was reached.</Trans>
                  </span>
                ) : undefined
              }
            >
              <div className="grid gap-2 text-sm">
                {computer.running && computer.usage ? (
                  <>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">
                        <Trans>Memory</Trans>
                      </span>
                      <span className="tabular-nums">
                        {memoryLabel(computer.usage.memoryGiB)} /{" "}
                        {memoryLabel(computer.limits.memoryGiB)}
                      </span>
                    </div>
                    {computer.limits.memoryGiB ? (
                      <progress
                        aria-label={t`Computer ${index + 1} memory usage`}
                        className="h-1 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-foreground [&::-moz-progress-bar]:bg-foreground"
                        value={computer.usage.memoryGiB}
                        max={computer.limits.memoryGiB}
                      />
                    ) : null}
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">
                        <Trans>CPU</Trans>
                      </span>
                      <span className="tabular-nums">
                        {cpuLabel(computer.usage.cpuCores)} / {cpuLabel(computer.limits.cpuCores)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">
                      {computer.running ? <Trans>Usage unavailable</Trans> : <Trans>Stopped</Trans>}
                    </span>
                    <span>
                      {memoryLabel(computer.limits.memoryGiB)} /{" "}
                      {cpuLabel(computer.limits.cpuCores)}
                    </span>
                  </div>
                )}
              </div>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
    </div>
  );
}
