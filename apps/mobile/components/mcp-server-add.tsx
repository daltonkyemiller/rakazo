import type { Bot, BotMcpServer, McpServer } from "@rakazo/contracts";
import type { McpDraft, McpInputError } from "@rakazo/core";
import { deriveMcpSlug, mcpDraftServerInput, parseMcpInput, uniqueMcpSlug } from "@rakazo/core";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { errorText } from "../lib/user-error";
import { NativeActionButton } from "./native-action-button";
import { SettingsSwitch } from "./settings-group";

function inputErrorText(error: McpInputError, t: (message: string) => string): string {
  if (error === "unterminated_quote") return t("A quote is not closed.");
  if (error === "shell_syntax") {
    return t("Shell variables, pipes, and substitutions are not run. Use plain values.");
  }
  if (error === "invalid_json") return t("This config is not valid JSON.");
  if (error === "invalid_url") return t("Use an http or https URL.");
  return t("No MCP servers found.");
}

/**
 * Paste-first MCP setup on the phone. Servers added here run where Rakazo is hosted; commands
 * on a Mac are added from the desktop app, and anyone can use them once assigned.
 */
export function McpServerAdd({
  servers,
  onAdded,
  onCancel,
}: {
  servers: McpServer[];
  onAdded: () => void;
  onCancel: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const [source, setSource] = useState("");
  const [touched, setTouched] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [added, setAdded] = useState<number[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const parsed = useMemo(() => parseMcpInput(source), [source]);
  const drafts = parsed.status === "ok" ? parsed.servers : [];
  const index = drafts.length === 1 ? 0 : chosen;
  const draft = index === null ? undefined : drafts[index];

  useEffect(() => {
    void rpc<Bot[]>("bots/list")
      .then((list) => setBots(list.filter((bot) => !bot.archivedAt)))
      .catch(() => undefined);
  }, []);

  return (
    <View testID="mcp-server-add" style={styles.card}>
      <TextInput
        value={source}
        onChangeText={(value) => {
          setSource(value);
          setChosen(null);
          setAdded([]);
        }}
        onEndEditing={() => setTouched(true)}
        accessibilityLabel={t("URL, command, or config")}
        placeholder="https://example.com/mcp"
        placeholderTextColor={native.tertiaryLabel}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        multiline
        style={[styles.input, styles.source]}
      />
      {touched && parsed.status === "error" ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {inputErrorText(parsed.error, t)}
        </Text>
      ) : null}
      {drafts.length > 1 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t("Choose a server")}>
          {drafts.map((entry, entryIndex) => {
            const done = added.includes(entryIndex);
            return (
              <Pressable
                key={`${entry.name}:${entryIndex}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen === entryIndex, disabled: done }}
                disabled={done}
                onPress={() => setChosen(entryIndex)}
                style={styles.choice}
              >
                <Text numberOfLines={1} style={[styles.title, styles.grow]}>
                  {entry.name}
                </Text>
                <Text style={styles.secondary}>
                  {done ? t("Added") : chosen === entryIndex ? "✓" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {draft && index !== null ? (
        <DraftForm
          key={`${source}\u0000${index}`}
          draft={draft}
          servers={servers}
          bots={bots}
          onAdded={() => {
            const remaining = drafts.length - added.length - 1;
            if (remaining > 0) {
              setAdded((current) => [...current, index]);
              setChosen(null);
            }
            onAdded();
            if (remaining <= 0) onCancel();
          }}
        />
      ) : null}
      {!draft ? (
        <NativeActionButton label={t("Cancel")} onPress={onCancel} prominence="secondary" />
      ) : null}
    </View>
  );
}

function DraftForm({
  draft,
  servers,
  bots,
  onAdded,
}: {
  draft: McpDraft;
  servers: McpServer[];
  bots: Bot[];
  onAdded: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const [name, setName] = useState(draft.name);
  const [values, setValues] = useState(draft.kind === "remote" ? draft.headers : draft.env);
  const [botIds, setBotIds] = useState<string[]>([]);
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    if (values.some((entry) => entry.missing && !entry.value.trim())) {
      setShowMissing(true);
      return;
    }
    const serverName = name.trim() || draft.name;
    setSaving(true);
    try {
      const created = await rpc<McpServer>(
        "mcp/servers/create",
        mcpDraftServerInput(draft, {
          slug: uniqueMcpSlug(
            deriveMcpSlug(serverName),
            servers.map((server) => server.slug),
          ),
          name: serverName,
          values: Object.fromEntries(values.map((entry) => [entry.name, entry.value])),
        }),
      );
      if (botIds.length > 0) {
        try {
          // replace() overwrites a bot's whole list, so merge with what it already has.
          const assignments = await rpc<BotMcpServer[]>("mcp/assignments/all");
          for (const botId of botIds) {
            await rpc("mcp/assignments/replace", {
              botId,
              assignments: [
                ...assignments
                  .filter((entry) => entry.botId === botId && entry.serverId !== created.id)
                  .map(({ serverId, allowAllTools, allowedTools }) => ({
                    serverId,
                    allowAllTools,
                    allowedTools,
                  })),
                { serverId: created.id, allowAllTools: true, allowedTools: [] },
              ],
            });
          }
        } catch (reason) {
          setError(errorText(reason, t("Could not update agent access")));
          return;
        }
      }
      onAdded();
    } catch (reason) {
      setError(errorText(reason, t("Could not add MCP server")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextInput
        value={name}
        onChangeText={setName}
        accessibilityLabel={t("Server name")}
        placeholder={t("Server name")}
        placeholderTextColor={native.tertiaryLabel}
        style={styles.input}
      />
      {draft.kind === "command" ? (
        <Text style={styles.secondary}>{t("Runs on Rakazo server")}</Text>
      ) : null}
      {values.map((entry, entryIndex) => (
        <View key={`${entry.name}:${entryIndex}`} style={styles.form}>
          <TextInput
            value={entry.value}
            onChangeText={(value) =>
              setValues((current) =>
                current.map((item, itemIndex) =>
                  itemIndex === entryIndex ? { ...item, value } : item,
                ),
              )
            }
            accessibilityLabel={entry.name}
            placeholder={entry.name}
            placeholderTextColor={native.tertiaryLabel}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          {showMissing && entry.missing && !entry.value.trim() ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {t("Add a value for {name}.", { name: entry.name })}
            </Text>
          ) : null}
        </View>
      ))}
      {bots.length > 0 ? (
        <View>
          <Text style={styles.section}>{t("Agents")}</Text>
          {bots.map((bot) => (
            <SettingsSwitch
              key={bot.id}
              label={bot.name}
              value={botIds.includes(bot.id)}
              onChange={(checked) =>
                setBotIds((current) =>
                  checked ? [...current, bot.id] : current.filter((id) => id !== bot.id),
                )
              }
            />
          ))}
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <NativeActionButton
        busy={saving}
        label={t("Add server")}
        onPress={() => void submit()}
        prominence="primary"
      />
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    card: { padding: 16, borderRadius: 16, backgroundColor: native.fill, gap: 12 },
    form: { gap: 8 },
    input: {
      minHeight: 48,
      borderRadius: 12,
      backgroundColor: native.fillPressed,
      color: native.label,
      paddingHorizontal: 14,
      fontSize: 15,
    },
    source: { minHeight: 72, paddingTop: 12, textAlignVertical: "top" },
    choice: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10 },
    grow: { flex: 1, minWidth: 0 },
    title: { color: native.label, fontSize: 15, fontWeight: "600" },
    secondary: { color: native.secondaryLabel, fontSize: 13 },
    section: { color: native.secondaryLabel, fontSize: 14, fontWeight: "600" },
    error: { color: mobileTokens().destructive, fontSize: 14 },
  });
}
