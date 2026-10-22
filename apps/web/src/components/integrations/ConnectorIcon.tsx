import { cn } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useState } from "react";

/** Catalog artwork for an app, falling back to its initial (or `fallback`) when missing or broken. */
export function ConnectorIcon({
  name,
  logo,
  className,
  fallback,
}: {
  name: string;
  logo?: string | null;
  className?: string;
  fallback?: ReactNode;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const frame =
    "size-9 shrink-0 rounded-lg border border-border bg-background text-sm font-semibold text-foreground";
  if (logo && failedLogo !== logo) {
    return (
      <img
        src={logo}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailedLogo(logo)}
        className={cn(frame, "object-contain p-1", className)}
      />
    );
  }
  if (fallback) return fallback;
  return (
    <div aria-hidden="true" className={cn(frame, "grid place-items-center", className)}>
      {name.trim()[0]?.toUpperCase()}
    </div>
  );
}
