import type { ReactNode } from "react";
import { useId } from "react";

/** Segmented controls share one pressed style: a crisp ring instead of a soft shadow. */
export const segmentedGroupClass = "grid min-w-0 gap-0.5 rounded-lg bg-muted p-0.5";
export const segmentedItemClass =
  "h-7 text-[13px] aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-border";

export function settingsTargetId(target: string) {
  return `settings-target-${target}`;
}

export const settingsTargetClass =
  "scroll-mt-6 rounded-sm outline-none data-highlighted:outline-2 data-highlighted:outline-offset-4 data-highlighted:outline-ring/60";

/** A titled group of settings rows. Sections stack without cards; rows carry the dividers. */
export function SettingsSection({
  title,
  target,
  testId,
  children,
}: {
  title?: ReactNode;
  target?: string;
  testId?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={target ? settingsTargetId(target) : undefined}
      aria-labelledby={title ? headingId : undefined}
      data-testid={testId}
      className={settingsTargetClass}
    >
      {title ? (
        <h3 id={headingId} className="pb-1 text-[13px] font-medium text-muted-foreground">
          {title}
        </h3>
      ) : null}
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/**
 * One setting: its label and optional detail on the start side, the control on the end side.
 * `stacked` puts wide controls (forms, lists) under the label instead.
 */
export function SettingsRow({
  label,
  labelFor,
  labelId,
  description,
  target,
  testId,
  stacked = false,
  children,
}: {
  label: ReactNode;
  /** The control's id, so clicking the label focuses it. */
  labelFor?: string;
  /** Lets group controls name themselves with aria-labelledby. */
  labelId?: string;
  description?: ReactNode;
  target?: string;
  testId?: string;
  stacked?: boolean;
  children?: ReactNode;
}) {
  const labelClass = "text-[13.5px] text-foreground";
  return (
    <div
      id={target ? settingsTargetId(target) : undefined}
      data-testid={testId}
      className={`${settingsTargetClass} flex min-h-12 gap-x-6 gap-y-2.5 py-3 ${
        stacked ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between"
      }`}
    >
      <div className="min-w-0">
        {labelFor ? (
          <label id={labelId} htmlFor={labelFor} className={labelClass}>
            {label}
          </label>
        ) : (
          <div id={labelId} className={labelClass}>
            {label}
          </div>
        )}
        {description ? (
          <div className="mt-0.5 text-[12.5px] leading-[1.45] text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {children === undefined ? null : (
        <div className={stacked ? "min-w-0" : "flex min-w-0 shrink-0 items-center gap-2"}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Settings sections stack with one consistent rhythm and a readable measure. */
export function SettingsStack({ children }: { children: ReactNode }) {
  return <div className="flex max-w-[680px] flex-col gap-8">{children}</div>;
}
