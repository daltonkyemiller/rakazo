import type { Bot, BotMcpServer, McpServer } from "@rakazo/contracts";
import { mcpServerLocation } from "@rakazo/core";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text } from "react-native";
import { glassHeaderOptions } from "../../components/glass-title";
import { SettingsGroup, SettingsRow, SettingsSwitch } from "../../components/settings-group";
import { rpc } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { mcpStatusText } from "../../lib/mcp-labels";
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
  const [testing, setTesting] = useState(false);
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
    setTesting(true);
    setError(null);
    try {
      setServer(await rpc<McpServer>("mcp/servers/test", { id }));
    } catch (err) {
      setError(errorText(err, t("Could not test MCP server")));
    } finally {
      setTesting(false);
    }
  }
  function remove() {
    Alert.alert(t("Remove {name}?", { name: server?.name ?? "" }), undefined, [
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
  // Servers from releases before health and OAuth reporting omit those fields.
  const health = server ? (server as Partial<McpServer>).health : undefined;
  const oauthStatus = server ? (server as Partial<McpServer>).oauthStatus : undefined;
  const status = server ? mcpStatusText(server, t) : null;
  const oauthText =
    oauthStatus === "connected"
      ? t("OAuth connected")
      : oauthStatus === "reconnect"
        ? t("OAuth expired")
        : server?.hasSecret
          ? t("Credential saved")
          : null;

  return (
    <>
      <Stack.Screen options={glassHeaderOptions(server?.name ?? t("MCP servers"))} />
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 24 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {error ? (
          <Text accessibilityRole="alert" style={{ color: colors.destructive, paddingStart: 16 }}>
            {error}
          </Text>
        ) : null}
        {server && location ? (
          <>
            <SettingsGroup
              footer={
                oauthStatus === "reconnect"
                  ? t("Sign in again from Rakazo on the web or your Mac.")
                  : undefined
              }
            >
              <SettingsRow
                key="runs-on"
                title={t("Runs on")}
                value={
                  location.kind === "mac"
                    ? t("Your Mac")
                    : location.kind === "server"
                      ? t("Rakazo server")
                      : location.host
                }
              />
              {health ? (
                <SettingsRow
                  key="status"
                  title={t("Status")}
                  value={testing ? t("Checking connection…") : (status ?? t("Not checked yet"))}
                  detail={health.status === "error" ? (health.message ?? undefined) : undefined}
                />
              ) : null}
              {oauthText ? (
                <SettingsRow key="oauth" title={t("Sign-in")} value={oauthText} />
              ) : null}
              {health ? (
                <SettingsRow
                  key="test"
                  title={t("Test connection")}
                  accessibilityRole="button"
                  disabled={testing || health.status === "installing"}
                  dimmed={testing || health.status === "installing"}
                  onPress={() => void test()}
                />
              ) : null}
            </SettingsGroup>

            {bots.length > 0 ? (
              <SettingsGroup label={t("Agents with access")}>
                {bots.map((bot) => (
                  <SettingsSwitch
                    key={bot.id}
                    label={bot.name}
                    value={assigned.includes(bot.id)}
                    disabled={pending}
                    onChange={(next) => void toggle(bot.id, next)}
                  />
                ))}
              </SettingsGroup>
            ) : null}

            <SettingsGroup label={t("Configuration")}>
              {location.kind === "remote" && server.endpoint ? (
                <SettingsRow key="url" title={t("URL")} detail={server.endpoint} />
              ) : null}
              {server.command ? (
                <SettingsRow
                  key="command"
                  title={t("Command")}
                  detail={[server.command, ...server.args].join(" ")}
                />
              ) : null}
              {server.envKeys?.length ? (
                <SettingsRow
                  key="env"
                  title={t("Environment variables")}
                  detail={server.envKeys.join(", ")}
                />
              ) : null}
              {server.headerKeys?.length ? (
                <SettingsRow
                  key="headers"
                  title={t("Headers")}
                  detail={server.headerKeys.join(", ")}
                />
              ) : null}
            </SettingsGroup>

            <SettingsGroup>
              <SettingsRow
                key="remove"
                title={t("Remove")}
                destructive
                accessibilityRole="button"
                disabled={pending}
                onPress={remove}
              />
            </SettingsGroup>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
