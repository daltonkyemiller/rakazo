import type { BotColorDef } from "@rakazo/core";
import type { ReactNode } from "react";

export const questionSurfaceClass = "w-[535px] max-w-full rounded-[20px] bg-muted px-[18px] py-3.5";

export function questionTextClass(answered: boolean): string {
  return `text-[15px] leading-[1.45] font-semibold ${answered ? "text-muted-foreground" : "text-foreground"}`;
}

function letterColorClass(picked: boolean, accent: BotColorDef | undefined): string {
  if (!picked) return "bg-background text-muted-foreground ring-1 ring-border ring-inset";
  return accent ? "" : "bg-primary text-primary-foreground";
}

/** The letter square before an option; the bot's identity color marks the one picked. */
function ChoiceLetter({
  letter,
  picked = false,
  accent,
}: {
  letter: string;
  picked?: boolean;
  accent?: BotColorDef;
}) {
  return (
    <span
      aria-hidden
      data-testid="choice-letter"
      className={`grid size-6 shrink-0 place-items-center rounded-[7px] text-[12px] leading-none font-medium ${letterColorClass(picked, accent)}`}
      style={
        picked && accent ? { backgroundColor: accent.light, color: accent.eyeColor } : undefined
      }
    >
      {letter}
    </span>
  );
}

const rowClass = "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-[10px] px-2 py-[7px]";

export function ChoiceOption({
  letter,
  label,
  pending,
  disabled,
  onChoose,
}: {
  letter: string;
  label: ReactNode;
  pending: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-busy={pending || undefined}
      disabled={disabled}
      onClick={onChoose}
      className={`${rowClass} text-start text-[15px] leading-[1.35] text-foreground transition-colors enabled:hover:bg-foreground/5 enabled:active:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pending ? "bg-foreground/5" : "disabled:opacity-50"}`}
    >
      <ChoiceLetter letter={letter} />
      <span className="min-w-0 flex-1 wrap-anywhere">{label}</span>
    </button>
  );
}

/**
 * The answered row: the picked option with its letter in the bot's color, or a typed answer
 * without a letter. `announcement` gives screen readers the outcome without visible status text.
 */
export function ChoiceAnswer({
  letter,
  label,
  accent,
  announcement,
}: {
  letter?: string;
  label: ReactNode;
  accent?: BotColorDef;
  announcement?: string;
}) {
  return (
    <div data-testid="choice-answer" className={`${rowClass} mt-1.5`}>
      {announcement ? <span className="sr-only">{announcement}</span> : null}
      {letter ? <ChoiceLetter letter={letter} picked accent={accent} /> : null}
      <span
        aria-hidden={announcement ? true : undefined}
        className="min-w-0 flex-1 text-[15px] leading-[1.35] text-foreground wrap-anywhere"
      >
        {label}
      </span>
    </div>
  );
}
