import type { Bot, BotMcpServer, McpServer } from "@rakazo/contracts";
import type { McpDraft, McpInputError } from "@rakazo/core";
import { deriveMcpSlug, mcpDraftServerInput, parseMcpInput, uniqueMcpSlug } from "@rakazo/core";
import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { rpc } from "../lib/api";
import { mobileTokens } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { errorText } from "../lib/user-error";
import { NativeActionButton } from "./native-action-button";
import { NativeSegmentedControl } from "./native-segmented-control";
import { SettingsGroup, SettingsRow, SettingsSwitch } from "./settings-group";

type Translate = (message: string, values?: Record<string, string | number>) => string;

type Row = { id: number; name: string; value: string; missing: boolean; added: boolean };

let nextRowId = 0;

function inputErrorText(error: McpInputError, t: Translate): string {
  if (error === "unterminated_quote") return t("A quote is not closed.");
  if (error === "shell_syntax") {
    return t("Shell variables, pipes, and substitutions are not run. Use plain values.");
  }
  if (error === "invalid_json") return t("This config is not valid JSON.");
  if (error === "invalid_url") return t("Use an http or https URL.");
  return t("No MCP servers found.");
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/** Environment variable names a Rakazo server accepts: capitals, digits, and underscores. */
function envName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/^(?=[0-9])/, "_");
}

function detectedText(drafts: McpDraft[], t: Translate): string | null {
  const [first] = drafts;
  if (!first) return null;
  if (drafts.length > 1) return t("{count} servers", { count: drafts.length });
  return first.kind === "remote"
    ? t("Remote server · {host}", { host: hostOf(first.endpoint) })
    : t("Command · {command}", { command: first.command });
}

/**
 * Paste-first MCP setup on the phone: the source first, then only what it needs. Servers added
 * here run where Rakazo is hosted; a command that should run on a Mac is added from the
 * desktop app, which asks before starting it.
 */
export function McpServerAdd({
  servers,
  onAdded,
  onDone,
}: {
  servers: McpServer[];
  onAdded: () => void;
  onDone: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const [source, setSource] = useState("");
  const [stage, setStage] = useState<"source" | "review">("source");
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

  function review() {
    setTouched(true);
    if (parsed.status === "ok") setStage("review");
  }

  if (stage === "source") {
    const detected = detectedText(drafts, t);
    return (
      <View testID="mcp-server-add" style={styles.stack}>
        <SettingsGroup label={t("URL, command, or config")}>
          <TextInput
            value={source}
            onChangeText={(value) => {
              // A paste that reads as a server goes straight to review; typing waits for Continue.
              const pasted = value.length - source.length > 1;
              setSource(value);
              setChosen(null);
              setAdded([]);
              if (pasted && parseMcpInput(value).status === "ok") setStage("review");
            }}
            onEndEditing={() => setTouched(Boolean(source.trim()))}
            accessibilityLabel={t("URL, command, or config")}
            placeholder="https://example.com/mcp"
            placeholderTextColor={native.tertiaryLabel}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            spellCheck={false}
            multiline
            style={styles.source}
          />
        </SettingsGroup>
        {touched && parsed.status === "error" ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {inputErrorText(parsed.error, t)}
          </Text>
        ) : detected ? (
          <Text style={styles.note}>{detected}</Text>
        ) : null}
        <NativeActionButton
          label={t("Continue")}
          disabled={!source.trim()}
          onPress={review}
          prominence="primary"
        />
      </View>
    );
  }

  return (
    <View testID="mcp-server-add" style={styles.stack}>
      {drafts.length > 1 ? (
        <SettingsGroup label={t("Choose a server")}>
          {drafts.map((entry, entryIndex) => {
            const done = added.includes(entryIndex);
            return (
              <SettingsRow
                key={`${entry.name}:${entryIndex}`}
                title={entry.name}
                detail={entry.kind === "remote" ? hostOf(entry.endpoint) : entry.command}
                value={done ? t("Added") : chosen === entryIndex ? "✓" : undefined}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen === entryIndex, disabled: done }}
                disabled={done}
                dimmed={done}
                onPress={() => setChosen(entryIndex)}
              />
            );
          })}
          <SettingsRow key="edit" title={t("Edit source")} onPress={() => setStage("source")} />
        </SettingsGroup>
      ) : null}
      {draft && index !== null ? (
        <DraftForm
          key={`${source}\u0000${index}`}
          draft={draft}
          servers={servers}
          bots={bots}
          onEditSource={drafts.length === 1 ? () => setStage("source") : undefined}
          onAdded={() => {
            const remaining = drafts.length - added.length - 1;
            onAdded();
            if (remaining <= 0) {
              onDone();
              return;
            }
            setAdded((current) => [...current, index]);
            setChosen(null);
          }}
        />
      ) : null}
    </View>
  );
}

function DraftForm({
  draft,
  servers,
  bots,
  onEditSource,
  onAdded,
}: {
  draft: McpDraft;
  servers: McpServer[];
  bots: Bot[];
  onEditSource?: () => void;
  onAdded: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { t } = useI18n();
  const command = draft.kind === "command";
  const [name, setName] = useState(draft.name);
  const [rows, setRows] = useState<Row[]>(() =>
    (draft.kind === "remote" ? draft.headers : draft.env).map((entry) => ({
      ...entry,
      id: nextRowId++,
      added: false,
    })),
  );
  const [authMode, setAuthMode] = useState<"open" | "token">("open");
  const [secret, setSecret] = useState("");
  const [botIds, setBotIds] = useState<string[]>([]);
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const duplicate = rows.some(
    (row, index) => row.name && rows.some((other, j) => j !== index && other.name === row.name),
  );

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function submit() {
    setError(null);
    const serverName = name.trim();
    if (!serverName) {
      setError(t("Add a server name."));
      return;
    }
    if (duplicate) {
      setError(t("Each name can be used once."));
      return;
    }
    if (rows.some((row) => row.missing && !row.value.trim())) {
      setShowMissing(true);
      return;
    }
    if (authMode === "token" && !secret.trim()) {
      setError(t("Add an access token."));
      return;
    }
    setSaving(true);
    try {
      const created = await rpc<McpServer>("mcp/servers/create", {
        ...mcpDraftServerInput(draft, {
          slug: uniqueMcpSlug(
            deriveMcpSlug(serverName),
            servers.map((server) => server.slug),
          ),
          name: serverName,
          values: Object.fromEntries(
            rows.filter((row) => row.name.trim()).map((row) => [row.name, row.value]),
          ),
        }),
        ...(authMode === "token" ? { secret } : {}),
      });
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

  const missingNames = showMissing
    ? rows.filter((row) => row.missing && !row.value.trim()).map((row) => row.name)
    : [];

  return (
    <View style={styles.stack}>
      <SettingsGroup
        footer={command ? t("To run it on your Mac, add it from the desktop app.") : undefined}
      >
        <TextInput
          key="name"
          value={name}
          onChangeText={setName}
          accessibilityLabel={t("Server name")}
          placeholder={t("Server name")}
          placeholderTextColor={native.tertiaryLabel}
          style={styles.cellInput}
        />
        <SettingsRow
          key="source"
          title={
            draft.kind === "remote" ? draft.endpoint : [draft.command, ...draft.args].join(" ")
          }
          value={onEditSource ? t("Edit") : undefined}
          onPress={onEditSource}
          accessibilityRole={onEditSource ? "button" : undefined}
          accessibilityLabel={onEditSource ? t("Edit source") : undefined}
        />
        <SettingsRow
          key="runs-on"
          title={t("Runs on")}
          value={draft.kind === "remote" ? hostOf(draft.endpoint) : t("Rakazo server")}
        />
      </SettingsGroup>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.label}>
          {t("Authentication")}
        </Text>
        <NativeSegmentedControl
          accessibilityLabel={t("Authentication")}
          value={authMode}
          onChange={setAuthMode}
          options={[
            { value: "open", label: command ? t("None") : t("Browser sign-in") },
            { value: "token", label: t("Access token") },
          ]}
        />
        {authMode === "token" ? (
          <SettingsGroup>
            <TextInput
              key="secret"
              value={secret}
              onChangeText={setSecret}
              accessibilityLabel={t("Access token")}
              placeholder={t("Access token")}
              placeholderTextColor={native.tertiaryLabel}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.cellInput}
            />
          </SettingsGroup>
        ) : command ? null : (
          <Text style={styles.note}>
            {t("If the server asks, sign in from Rakazo on the web or your Mac.")}
          </Text>
        )}
      </View>

      <SettingsGroup label={command ? t("Environment variables") : t("Headers")}>
        {rows.map((row) => (
          <View key={row.id} style={styles.valueRow}>
            {row.added ? (
              <TextInput
                value={row.name}
                onChangeText={(value) =>
                  updateRow(row.id, { name: command ? envName(value) : value })
                }
                accessibilityLabel={t("Name")}
                placeholder={command ? "API_KEY" : "Authorization"}
                placeholderTextColor={native.tertiaryLabel}
                autoCapitalize={command ? "characters" : "none"}
                autoCorrect={false}
                style={[styles.valueName, styles.valueInput]}
              />
            ) : (
              <Text numberOfLines={1} style={styles.valueName}>
                {row.name}
              </Text>
            )}
            <TextInput
              value={row.value}
              onChangeText={(value) => updateRow(row.id, { value })}
              accessibilityLabel={row.added ? t("Value") : row.name}
              placeholder={row.missing ? t("Required") : t("Stored encrypted")}
              placeholderTextColor={native.tertiaryLabel}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.valueInput, styles.grow]}
            />
          </View>
        ))}
        <SettingsRow
          key="add"
          title={command ? t("Add variable") : t("Add header")}
          onPress={() =>
            setRows((current) => [
              ...current,
              { id: nextRowId++, name: "", value: "", missing: false, added: true },
            ])
          }
        />
      </SettingsGroup>
      {missingNames.map((missing) => (
        <Text key={missing} accessibilityRole="alert" style={styles.error}>
          {t("Add a value for {name}.", { name: missing })}
        </Text>
      ))}

      {bots.length > 0 ? (
        <SettingsGroup label={t("Agents with access")}>
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
        </SettingsGroup>
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

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

function createStyles() {
  return StyleSheet.create({
    stack: { gap: 24 },
    section: { gap: 10 },
    label: { color: native.secondaryLabel, fontSize: 13, paddingStart: 16 },
    source: {
      minHeight: 120,
      maxHeight: 280,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 14,
      color: native.label,
      fontSize: 15,
      fontFamily: MONOSPACE,
      textAlignVertical: "top",
    },
    cellInput: { minHeight: 52, paddingHorizontal: 16, color: native.label, fontSize: 17 },
    valueRow: {
      minHeight: 52,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    valueName: {
      width: "40%",
      color: native.label,
      fontSize: 15,
      fontFamily: MONOSPACE,
    },
    valueInput: { minHeight: 44, color: native.label, fontSize: 17 },
    grow: { flex: 1, minWidth: 0 },
    note: { color: native.secondaryLabel, fontSize: 13, paddingHorizontal: 16 },
    error: { color: mobileTokens().destructive, fontSize: 14, paddingHorizontal: 16 },
  });
}
