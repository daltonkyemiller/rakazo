import { Trans } from "@lingui/react/macro";
import { Field, FieldLabel, Input, Toggle } from "@rakazo/ui-web";
import { useId } from "react";
import { segmentedGroupClass, segmentedItemClass } from "../../components/SettingsLayout";

export type ConnectionMode = "cloud" | "local";

/** Hosted service or a self-hosted instance at a base URL. */
export function ConnectionModeFields({
  busy,
  mode,
  onModeChange,
  baseUrl,
  onBaseUrlChange,
  baseUrlPlaceholder,
}: {
  busy: boolean;
  mode: ConnectionMode;
  onModeChange: (mode: ConnectionMode) => void;
  baseUrl: string;
  onBaseUrlChange: (baseUrl: string) => void;
  baseUrlPlaceholder: string;
}) {
  const baseUrlId = useId();
  const connectionLabelId = useId();
  return (
    <>
      <Field className="mt-4" aria-labelledby={connectionLabelId}>
        <FieldLabel id={connectionLabelId}>
          <Trans>Connection</Trans>
        </FieldLabel>
        <div className={`${segmentedGroupClass} grid-cols-2`}>
          {(["cloud", "local"] as const).map((option) => (
            <Toggle
              key={option}
              pressed={mode === option}
              disabled={busy}
              onPressedChange={() => onModeChange(option)}
              className={segmentedItemClass}
            >
              {option === "cloud" ? <Trans>Cloud</Trans> : <Trans>Local</Trans>}
            </Toggle>
          ))}
        </div>
      </Field>

      {mode === "local" ? (
        <Field className="mt-4">
          <FieldLabel htmlFor={baseUrlId}>
            <Trans>Base URL</Trans>
          </FieldLabel>
          <Input
            id={baseUrlId}
            value={baseUrl}
            disabled={busy}
            onChange={(event) => onBaseUrlChange(event.target.value)}
            placeholder={baseUrlPlaceholder}
          />
        </Field>
      ) : null}
    </>
  );
}
