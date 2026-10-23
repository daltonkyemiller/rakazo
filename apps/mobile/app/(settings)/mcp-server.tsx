import type { Bot, BotMcpServer, McpServer } from "@rakazo/contracts";
import { mcpServerLocation } from "@rakazo/core";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { glassHeaderOptions } from "../../components/glass-title";
import { NativeActionButton } from "../../components/native-action-button";
import { SettingsSwitch } from "../../components/settings-group";
import { rpc } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useMobileTokens } from "../../lib/native";
import { errorText } from "../../lib/user-error";

/** Existing connections use native stack navigation; a phone never grants host execution. */
export default function McpServerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const colors = useMobileTokens();
  const [server, setServer] = useState<McpServer | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [servers, nextBots, assignments] = await Promise.all([
      rpc<McpServer[]>("mcp/servers/list"),
      rpc<Bot[]>("bots/list"),
      rpc<BotMcpServer[]>("mcp/assignments/all"),
    ]);
    const current = servers.find((entry) => entry.id === id);
    if (!current) throw new Error(t("This server is no longer available."));
    setServer(current);
    setBots(nextBots.filter((bot) => !bot.archivedAt));
    setAssigned(assignments.filter((entry) => entry.serverId === id).map((entry) => entry.botId));
  }, [id, t]);
  useEffect(() => {
    void load().catch((err) => setError(errorText(err, t("Could not load MCP servers"))));
  }, [load, t]);

  async function toggle(botId: string, enabled: boolean) {
    setPending(true);
    setError(null);
    try {
      const current = await rpc<BotMcpServer[]>("mcp/assignments/list", { botId });
      const assignments = current
        .filter((entry) => entry.serverId !== id)
        .map(({ serverId, allowAllTools, allowedTools }) => ({
          serverId,
          allowAllTools,
          allowedTools,
        }));
      if (enabled) assignments.push({ serverId: id, allowAllTools: true, allowedTools: [] });
      await rpc("mcp/assignments/replace", { botId, assignments });
      await load();
    } catch (err) {
      setError(errorText(err, t("Could not update agent access")));
    } finally {
      setPending(false);
    }
  }
  async function test() {
    setPending(true);
    setError(null);
    try {
      setServer(await rpc<McpServer>("mcp/servers/test", { id }));
    } catch (err) {
      setError(errorText(err, t("Could not test MCP server")));
    } finally {
      setPending(false);
    }
  }
  function remove() {
    Alert.alert(t("Remove"), server?.name, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Remove"),
        style: "destructive",
        onPress: () => {
          setPending(true);
          void rpc("mcp/servers/remove", { id })
            .then(() => router.back())
            .catch((err) => {
              setError(errorText(err, t("Could not remove MCP server")));
              setPending(false);
            });
        },
      },
    ]);
  }
  const location = server && mcpServerLocation(server);
  const locationText =
    location?.kind === "mac"
      ? t("Runs on your Mac")
      : location?.kind === "server"
        ? t("Runs on Rakazo server")
        : location?.kind === "remote"
          ? location.host
          : "";
  return (
    <>
      <Stack.Screen options={glassHeaderOptions(server?.name ?? t("MCP servers"))} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
            {error}
          </Text>
        ) : null}
        {server ? (
          <>
            <Text style={{ color: colors.mutedForeground }}>{locationText}</Text>
            {server.description ? (
              <Text style={{ color: colors.foreground }}>{server.description}</Text>
            ) : null}
            {server.health?.message ? (
              <Text
                style={{
                  color:
                    server.health.status === "error" ? colors.destructive : colors.mutedForeground,
                }}
              >
                {server.health.message}
              </Text>
            ) : null}
            {server.health ? (
              <NativeActionButton
                label={t("Test connection")}
                disabled={pending}
                onPress={() => void test()}
              />
            ) : null}
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={{ color: colors.mutedForeground }}>
                {t("Agents")}
              </Text>
              {bots.map((bot) => (
                <SettingsSwitch
                  key={bot.id}
                  label={bot.name}
                  value={assigned.includes(bot.id)}
                  disabled={pending}
                  onChange={(next) => void toggle(bot.id, next)}
                />
              ))}
            </View>
            <NativeActionButton label={t("Remove")} disabled={pending} onPress={remove} />
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
