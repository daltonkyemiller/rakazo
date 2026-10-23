import type { BotMcpServer, McpServer, Me } from "@rakazo/contracts";
import { grantMacAccess, macComputerServers, revokeMacAccess } from "@rakazo/core";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { errorText } from "../lib/user-error";
import { NativeSwitch } from "./native-switch";

type MacAccessData = {
  legacyHost: boolean;
  macServers: McpServer[];
  assignments: BotMcpServer[];
};

/**
 * A bot's access to the Mac's commands and files. Phones can turn existing access on or off for a
 * bot; approving a Mac happens only in Rakazo on that Mac.
 */
export function MacAccessRow({ botId }: { botId: string }) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [data, setData] = useState<MacAccessData | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [me, servers, assignments] = await Promise.all([
      rpc<Pick<Me, "computerHost">>("me"),
      rpc<McpServer[]>("mcp/servers/list"),
      rpc<BotMcpServer[]>("mcp/assignments/list", { botId }),
    ]);
    setData({
      legacyHost: me.computerHost === "this-mac",
      macServers: macComputerServers(servers),
      assignments,
    });
  }, [botId]);

  useEffect(() => {
    setData(null);
    void load().catch(() => undefined);
  }, [load]);

  if (!data) return null;

  const macServerIds = data.macServers.map((server) => server.id);
  const assigned = data.macServers.filter((server) =>
    data.assignments.some((assignment) => assignment.serverId === server.id),
  );
  const grantable = data.macServers.find((server) => server.enabled);
  const checked = assigned.length > 0;

  async function toggle(next: boolean) {
    setPending(true);
    setError(null);
    try {
      const current = await rpc<BotMcpServer[]>("mcp/assignments/list", { botId });
      const assignments =
        next && grantable
          ? grantMacAccess(current, grantable.id)
          : revokeMacAccess(current, macServerIds);
      await rpc("mcp/assignments/replace", { botId, assignments });
      await load();
    } catch (err) {
      setError(errorText(err, t("Could not change Mac access")));
    } finally {
      setPending(false);
    }
  }

  let note = t("Commands and files");
  if (data.legacyHost) note = t("Bots already run on your Mac.");
  else if (!checked && !grantable) note = t("Allow it from Rakazo on your Mac.");
  else if (assigned.some((server) => server.health?.status === "error"))
    note = t("Open Rakazo on your Mac to use it.");

  return (
    <View style={{ gap: 4 }}>
      <View style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: tokens.foreground, fontSize: 14 }}>{t("Mac access")}</Text>
          <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>{note}</Text>
        </View>
        {!data.legacyHost && (checked || grantable) ? (
          <NativeSwitch
            accessibilityLabel={t("Mac access")}
            disabled={pending}
            onValueChange={(next) => void toggle(next)}
            value={checked}
          />
        ) : null}
      </View>
      {error ? <Text style={{ color: tokens.destructive, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}
