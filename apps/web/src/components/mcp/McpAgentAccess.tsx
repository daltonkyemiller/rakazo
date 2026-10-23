import { Trans } from "@lingui/react/macro";
import type { Bot } from "@rakazo/contracts";
import { BotAvatar, Switch } from "@rakazo/ui-web";
import { useId } from "react";

/**
 * The agents allowed to call a server's tools. This list is the access boundary: mentioning
 * a server in a message never grants it.
 */
export function McpAgentAccess({
  bots,
  isAssigned,
  onChange,
  disabled = false,
}: {
  bots: Bot[];
  isAssigned: (botId: string) => boolean;
  onChange: (botId: string, assigned: boolean) => void;
  disabled?: boolean;
}) {
  const ids = useId();
  if (bots.length === 0) return null;
  return (
    <section data-testid="mcp-server-agents" aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className="mb-2 text-[13px] font-medium text-muted-foreground">
        <Trans>Agents with access</Trans>
      </h3>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {bots.map((bot) => {
          const switchId = `${ids}-${bot.id}`;
          return (
            <li key={bot.id} className="flex min-h-11 items-center gap-3 px-3">
              <label
                id={`${switchId}-label`}
                htmlFor={switchId}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-2 text-sm text-foreground"
              >
                <BotAvatar color={bot.color} identity={bot.id} size={22} />
                <span className="truncate" dir="auto">
                  {bot.name}
                </span>
              </label>
              <Switch
                id={switchId}
                aria-labelledby={`${switchId}-label`}
                checked={isAssigned(bot.id)}
                disabled={disabled}
                onCheckedChange={(checked) => onChange(bot.id, checked)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
