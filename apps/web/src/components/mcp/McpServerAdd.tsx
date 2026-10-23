import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, IntegrationCatalogSurface, McpServer } from "@rakazo/contracts";
import type { McpDraft, McpInputError } from "@rakazo/core";
import { deriveMcpSlug, mcpDraftServerInput, parseMcpInput, uniqueMcpSlug } from "@rakazo/core";
import {
  Button,
  Disclosure,
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  NativeSelect,
  NativeSelectOption,
  RadioGroup,
  RadioGroupItem,
  SwitchField,
  Textarea,
  Toggle,
} from "@rakazo/ui-web";
import { X } from "lucide-react";
import type { FormEvent } from "react";
import { useId, useMemo, useState } from "react";
import { mcpOAuthRedirectUri } from "../../lib/mcp-connect";
import type { HostMcpState } from "../../lib/mcp-host";
import { addHostMcpServer, HostMcpCleanupError } from "../../lib/mcp-host";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

type Row = { id: number; name: string; value: string; file: boolean; missing: boolean };

let nextRowId = 0;
const emptyRow = (): Row => ({ id: nextRowId++, name: "", value: "", file: false, missing: false });

/** Environment variable names a Rakazo server accepts: capitals, digits, and underscores. */
function envName(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/^(?=[0-9])/, "_");
}

function inputErrorText(error: McpInputError): string {
  if (error === "unterminated_quote") return t`A quote is not closed.`;
  if (error === "shell_syntax") {
    return t`Shell variables, pipes, and substitutions are not run. Use plain values.`;
  }
  if (error === "invalid_json") return t`This config is not valid JSON.`;
  if (error === "invalid_url") return t`Use an http or https URL.`;
  return t`No MCP servers found.`;
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/**
 * Source-first setup: paste a URL, a command line, or a client config, then confirm the
 * few details that matter. Credentials arrive in password fields and placeholders from docs
 * are cleared, never sent.
 */
export function McpServerAdd({
  initialSource = "",
  initialName,
  initialAuth,
  servers,
  bots,
  host,
  onAdded,
}: {
  initialSource?: string;
  initialName?: string;
  /** What a catalog entry says about authenticating, when the source came from one. */
  initialAuth?: IntegrationCatalogSurface["auth"];
  servers: McpServer[];
  bots: Bot[];
  host: HostMcpState;
  onAdded: (server: McpServer, botIds: string[], more: boolean) => void;
}) {
  const sourceId = useId();
  const formId = useId();
  const [source, setSource] = useState(initialSource);
  const [touched, setTouched] = useState(Boolean(initialSource));
  const [chosen, setChosen] = useState<number | null>(null);
  const [added, setAdded] = useState<number[]>([]);
  const parsed = useMemo(() => parseMcpInput(source), [source]);
  const drafts = parsed.status === "ok" ? parsed.servers : [];
  const index = drafts.length === 1 ? 0 : chosen;
  const draft = index === null ? undefined : drafts[index];
  const parseError = touched && parsed.status === "error" ? inputErrorText(parsed.error) : null;
  const fromConfig = /^[{"]/.test(source.trim());

  return (
    <div className="space-y-6">
      <Field data-invalid={parseError ? true : undefined}>
        <FieldLabel htmlFor={sourceId}>
          <Trans>URL, command, or config</Trans>
        </FieldLabel>
        <Textarea
          id={sourceId}
          value={source}
          autoFocus={!initialSource}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={parseError ? true : undefined}
          aria-describedby={parseError ? `${sourceId}-error` : undefined}
          placeholder="https://example.com/mcp"
          className="max-h-60 min-h-20 font-mono text-xs"
          onChange={(event) => {
            setSource(event.target.value);
            setChosen(null);
            setAdded([]);
          }}
          onBlur={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            setTouched(true);
            const form = document.getElementById(formId);
            if (form instanceof HTMLFormElement) form.requestSubmit();
          }}
        />
        {parseError ? <FieldError id={`${sourceId}-error`}>{parseError}</FieldError> : null}
      </Field>

      {drafts.length > 1 ? (
        <FieldSet className="gap-1">
          <FieldLegend variant="label">
            <Trans>Choose a server</Trans>
          </FieldLegend>
          <RadioGroup
            className="gap-0"
            value={chosen === null ? "" : String(chosen)}
            onValueChange={(value) => setChosen(Number(value))}
          >
            {drafts.map((entry, entryIndex) => {
              const done = added.includes(entryIndex);
              return (
                // biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control.
                <label
                  key={`${entry.name}:${entryIndex}`}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-accent/60 has-disabled:cursor-default has-disabled:hover:bg-transparent"
                >
                  <RadioGroupItem value={String(entryIndex)} disabled={done} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">
                    {entry.name}
                  </span>
                  <span className="max-w-[45%] truncate font-mono text-xs text-muted-foreground">
                    {done
                      ? t`Added`
                      : entry.kind === "remote"
                        ? hostOf(entry.endpoint)
                        : entry.command}
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        </FieldSet>
      ) : null}

      {draft && index !== null ? (
        <DraftForm
          key={`${source}\u0000${index}`}
          formId={formId}
          draft={draft}
          initialName={source === initialSource ? initialName : undefined}
          auth={source === initialSource ? initialAuth : undefined}
          showCommand={fromConfig}
          servers={servers}
          bots={bots}
          host={host}
          onAdded={(server, botIds) => {
            const remaining = drafts.length - added.length - 1;
            if (remaining > 0) {
              setAdded((current) => [...current, index]);
              setChosen(null);
            }
            onAdded(server, botIds, remaining > 0);
          }}
        />
      ) : (
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
          }}
        />
      )}
    </div>
  );
}

function DraftForm({
  formId,
  draft,
  initialName,
  auth,
  showCommand,
  servers,
  bots,
  host,
  onAdded,
}: {
  formId: string;
  draft: McpDraft;
  initialName?: string;
  auth?: IntegrationCatalogSurface["auth"];
  showCommand: boolean;
  servers: McpServer[];
  bots: Bot[];
  host: HostMcpState;
  onAdded: (server: McpServer, botIds: string[]) => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const [name, setName] = useState(initialName ?? draft.name);
  const [runsOnChoice, setRunsOnChoice] = useState<"server" | "mac" | null>(null);
  const [transport, setTransport] = useState(
    draft.kind === "remote" ? draft.transport : "streamable_http",
  );
  const [rows, setRows] = useState<Row[]>(() => [
    ...(draft.kind === "remote" ? draft.headers : draft.env).map((entry) => ({
      ...entry,
      id: nextRowId++,
      file: false,
    })),
    ...(auth?.type === "header" && draft.kind === "remote"
      ? [{ ...emptyRow(), name: auth.headerName ?? "x-api-key", missing: true }]
      : []),
  ]);
  // A catalog entry that expects a bearer token keeps the field in view instead of Advanced.
  const bearer = auth?.type === "bearer" && draft.kind === "remote";
  const [cwd, setCwd] = useState(draft.kind === "command" ? (draft.cwd ?? "") : "");
  const [secret, setSecret] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthAuthorizationServer, setOauthAuthorizationServer] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthParams, setOauthParams] = useState("");
  const [botIds, setBotIds] = useState<string[]>([]);
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const command = draft.kind === "command";
  // Without the desktop bridge a command can only run on the Rakazo server.
  const runsOn = command ? (host.bridge ? runsOnChoice : "server") : null;
  const onMac = runsOn === "mac";
  // A config's own working directory stays in view so it can be cleared for the server.
  const cwdInMain = draft.kind === "command" && Boolean(draft.cwd);
  const rowLabel = command ? t`Environment variables` : t`Headers`;
  const keyOf = (row: Row) => (command && !onMac ? envName(row.name) : row.name);
  const duplicates = new Set(
    rows
      .filter(
        (row, index) =>
          row.name && rows.some((other, j) => j !== index && keyOf(other) === keyOf(row)),
      )
      .map((row) => row.id),
  );
  const missingRows = rows.filter((row) => row.missing && !row.value.trim());

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function entries(file: boolean) {
    return Object.fromEntries(
      rows
        .filter((row) => row.name.trim() && row.file === file)
        .map((row) => [row.name, row.value]),
    );
  }

  const oauthBase = oauthClientId.trim()
    ? {
        clientId: oauthClientId.trim(),
        clientSecret: oauthClientSecret || undefined,
        scope: oauthScope.trim() || undefined,
        authorizationParams: oauthParams.trim() || undefined,
      }
    : undefined;

  async function create(slug: string, serverName: string): Promise<McpServer | null> {
    const base = mcpDraftServerInput(draft, {
      slug,
      name: serverName,
      values: entries(false),
      transport,
    });
    if (base.transport !== "stdio") {
      return rpc.mcp.servers.create({
        ...base,
        secret: secret || undefined,
        oauthClient: oauthBase,
      });
    }
    if (onMac && host.bridge && draft.kind === "command") {
      const result = await addHostMcpServer(
        host.bridge,
        {
          kind: "command",
          name: serverName,
          command: draft.command,
          args: draft.args,
          cwd: cwd.trim() || undefined,
          env: entries(false),
        },
        {
          create: (endpoint, token) =>
            rpc.mcp.servers.create({
              slug,
              name: serverName,
              transport: "streamable_http",
              endpoint,
              secret: token,
              enabled: true,
            }),
          remove: (id) => rpc.mcp.servers.remove({ id }),
        },
      );
      await host.refresh();
      return result.status === "added" ? result.server : null;
    }
    const files = entries(true);
    return rpc.mcp.servers.create({
      ...base,
      ...(Object.keys(files).length > 0 ? { files } : {}),
      secret: secret || undefined,
      oauthClient: oauthBase
        ? { ...oauthBase, authorizationServer: oauthAuthorizationServer.trim() }
        : undefined,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const serverName = name.trim();
    if (!serverName) {
      setError(t`Add a server name.`);
      return;
    }
    if (duplicates.size > 0) return;
    if (missingRows.length > 0) {
      setShowMissing(true);
      document.getElementById(`${ids}-value-${missingRows[0]?.id}`)?.focus();
      return;
    }
    if (command && !runsOn) {
      setError(t`Choose where it runs.`);
      return;
    }
    if (command && !onMac && cwd.trim()) {
      setError(t`A working directory only works on this Mac.`);
      return;
    }
    if (onMac && rows.some((row) => row.file)) {
      setError(t`Credential files only work on the Rakazo server.`);
      return;
    }
    setSaving(true);
    try {
      const slug = uniqueMcpSlug(
        deriveMcpSlug(serverName),
        servers.map((server) => server.slug),
      );
      const created = await create(slug, serverName);
      if (created) onAdded(created, botIds);
    } catch (err) {
      setError(
        err instanceof HostMcpCleanupError
          ? t`Could not add ${serverName}, and its setup on this Mac could not be removed.`
          : errorText(err, t`Could not add MCP server`),
      );
    } finally {
      setSaving(false);
    }
  }

  const rowsSection =
    rows.length > 0 || command ? (
      <FieldSet className="gap-2">
        <FieldLegend variant="label">{rowLabel}</FieldLegend>
        {rows.map((row) => {
          const invalidValue = showMissing && row.missing && !row.value.trim();
          const errorId = `${ids}-row-error-${row.id}`;
          const visibleValue = row.value.includes("{{oauth.");
          return (
            <Field
              key={row.id}
              orientation="horizontal"
              data-invalid={duplicates.has(row.id) || invalidValue || undefined}
              className="grid grid-cols-[.7fr_1fr_auto_auto] items-start gap-2"
            >
              <Input
                aria-label={t`Name`}
                aria-invalid={duplicates.has(row.id) || undefined}
                aria-describedby={duplicates.has(row.id) ? errorId : undefined}
                autoComplete="off"
                spellCheck={false}
                className={row.file ? "col-span-2 font-mono text-xs" : "font-mono text-xs"}
                value={row.name}
                placeholder={command ? "API_KEY" : "Authorization"}
                onChange={(event) =>
                  updateRow(row.id, {
                    name: command && !onMac ? envName(event.target.value) : event.target.value,
                  })
                }
              />
              {row.file ? null : (
                <Input
                  id={`${ids}-value-${row.id}`}
                  aria-label={t`Value`}
                  aria-invalid={invalidValue || undefined}
                  aria-describedby={invalidValue ? errorId : undefined}
                  type={visibleValue ? "text" : "password"}
                  autoComplete={visibleValue ? "off" : "new-password"}
                  value={row.value}
                  placeholder={row.missing ? t`Required` : t`Stored encrypted`}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                />
              )}
              {command && !onMac ? (
                <Toggle
                  variant="outline"
                  size="sm"
                  pressed={row.file}
                  onPressedChange={(file) => updateRow(row.id, { file })}
                >
                  <Trans>File</Trans>
                </Toggle>
              ) : (
                <span />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={row.name ? t`Remove ${row.name}` : t`Remove`}
                onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
              >
                <X />
              </Button>
              {row.file ? (
                <Textarea
                  aria-label={t`Value`}
                  autoComplete="off"
                  spellCheck={false}
                  className="col-span-full min-h-24 font-mono text-xs"
                  value={row.value}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                />
              ) : null}
              {duplicates.has(row.id) ? (
                <FieldError id={errorId} className="col-span-full">
                  <Trans>Each name can be used once.</Trans>
                </FieldError>
              ) : invalidValue ? (
                <FieldError id={errorId} className="col-span-full">
                  <Trans>Add a value for {row.name}.</Trans>
                </FieldError>
              ) : null}
            </Field>
          );
        })}
        {command ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            onClick={() => setRows((current) => [...current, emptyRow()])}
          >
            <Trans>Add variable</Trans>
          </Button>
        ) : null}
        {command && !onMac && oauthClientId.trim() ? (
          <p className="text-xs text-muted-foreground">
            <Trans>Use {"{{oauth.access_token}}"} for the access token.</Trans>
          </p>
        ) : null}
      </FieldSet>
    ) : null;

  const secretField = (
    <Field>
      <FieldLabel htmlFor={`${ids}-secret`}>
        {bearer ? <Trans>Access token</Trans> : <Trans>Access token (optional)</Trans>}
      </FieldLabel>
      <Input
        id={`${ids}-secret`}
        type="password"
        autoComplete="new-password"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        placeholder={t`Stored encrypted`}
      />
    </Field>
  );

  const oauthFields = (
    <>
      {bearer ? null : secretField}
      <Field>
        <FieldLabel htmlFor={`${ids}-oauth-client-id`}>
          <Trans>OAuth client ID (optional)</Trans>
        </FieldLabel>
        <Input
          id={`${ids}-oauth-client-id`}
          autoComplete="off"
          value={oauthClientId}
          onChange={(event) => setOauthClientId(event.target.value)}
        />
      </Field>
      {oauthClientId.trim() ? (
        <>
          <Field>
            <FieldLabel htmlFor={`${ids}-oauth-client-secret`}>
              <Trans>OAuth client secret (optional)</Trans>
            </FieldLabel>
            <Input
              id={`${ids}-oauth-client-secret`}
              type="password"
              autoComplete="new-password"
              value={oauthClientSecret}
              onChange={(event) => setOauthClientSecret(event.target.value)}
              placeholder={t`Stored encrypted`}
            />
          </Field>
          {command ? (
            <Field>
              <FieldLabel htmlFor={`${ids}-oauth-authorization-server`}>
                <Trans>Authorization server</Trans>
              </FieldLabel>
              <Input
                id={`${ids}-oauth-authorization-server`}
                type="url"
                autoComplete="off"
                value={oauthAuthorizationServer}
                onChange={(event) => setOauthAuthorizationServer(event.target.value)}
                placeholder="https://accounts.google.com"
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor={`${ids}-oauth-scope`}>
              <Trans>Scopes (optional)</Trans>
            </FieldLabel>
            <Input
              id={`${ids}-oauth-scope`}
              autoComplete="off"
              value={oauthScope}
              onChange={(event) => setOauthScope(event.target.value)}
              placeholder="openid email"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-oauth-params`}>
              <Trans>Authorization parameters (optional)</Trans>
            </FieldLabel>
            <Input
              id={`${ids}-oauth-params`}
              autoComplete="off"
              value={oauthParams}
              onChange={(event) => setOauthParams(event.target.value)}
              placeholder="access_type=offline&prompt=consent"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-oauth-redirect-uri`}>
              <Trans>Redirect URI</Trans>
            </FieldLabel>
            <Input
              id={`${ids}-oauth-redirect-uri`}
              readOnly
              value={mcpOAuthRedirectUri()}
              onFocus={(event) => event.target.select()}
            />
          </Field>
        </>
      ) : null}
    </>
  );

  return (
    <form
      id={formId}
      data-testid="mcp-server-draft"
      className="space-y-6"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <Field>
        <FieldLabel htmlFor={`${ids}-name`}>
          <Trans>Server name</Trans>
        </FieldLabel>
        <Input
          id={`${ids}-name`}
          value={name}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      {auth?.note ? <p className="text-xs text-muted-foreground">{auth.note}</p> : null}

      {bearer ? secretField : null}

      {command && showCommand ? (
        <p dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
          {[draft.command, ...draft.args].join(" ")}
        </p>
      ) : null}

      {command ? (
        host.bridge ? (
          <FieldSet className="gap-1.5">
            <FieldLegend variant="label">
              <Trans>Runs on</Trans>
            </FieldLegend>
            <RadioGroup
              className="gap-1.5"
              value={runsOnChoice ?? ""}
              onValueChange={(value) => setRunsOnChoice(value as "server" | "mac")}
            >
              {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control. */}
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3">
                <RadioGroupItem value="server" className="mt-0.5" />
                <span>
                  <span className="block text-sm text-foreground">
                    <Trans>Rakazo server</Trans>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    <Trans>Runs where Rakazo is hosted, away from this Mac.</Trans>
                  </span>
                </span>
              </label>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control. */}
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3">
                <RadioGroupItem value="mac" className="mt-0.5" />
                <span>
                  <span className="block text-sm text-foreground">
                    <Trans>This Mac</Trans>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    <Trans>Runs as you, with your access to files and apps.</Trans>
                  </span>
                </span>
              </label>
            </RadioGroup>
          </FieldSet>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Trans>Runs on Rakazo server</Trans>
          </p>
        )
      ) : null}

      {rowsSection}

      {cwdInMain ? (
        <Field>
          <FieldLabel htmlFor={`${ids}-cwd`}>
            <Trans>Working directory</Trans>
          </FieldLabel>
          <Input
            id={`${ids}-cwd`}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
          />
        </Field>
      ) : null}

      {!command || runsOn === "server" || (onMac && !cwdInMain) ? (
        <Disclosure
          className="group"
          summary={<Trans>Advanced</Trans>}
          summaryClassName="text-sm text-muted-foreground"
        >
          <div className="space-y-4 pt-4">
            {!command ? (
              <>
                <Field>
                  <FieldLabel htmlFor={`${ids}-transport`}>
                    <Trans>Transport</Trans>
                  </FieldLabel>
                  <NativeSelect
                    id={`${ids}-transport`}
                    className="w-full"
                    value={transport}
                    onChange={(event) => setTransport(event.target.value as typeof transport)}
                  >
                    <NativeSelectOption value="streamable_http">Streamable HTTP</NativeSelectOption>
                    <NativeSelectOption value="sse">SSE</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setRows((current) => [...current, emptyRow()])}
                >
                  <Trans>Add header</Trans>
                </Button>
              </>
            ) : null}
            {onMac ? (
              <Field>
                <FieldLabel htmlFor={`${ids}-cwd`}>
                  <Trans>Working directory</Trans>
                </FieldLabel>
                <Input
                  id={`${ids}-cwd`}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                />
              </Field>
            ) : (
              oauthFields
            )}
          </div>
        </Disclosure>
      ) : null}

      {bots.length > 0 ? (
        <FieldSet className="gap-3">
          <FieldLegend variant="label">
            <Trans>Agents</Trans>
          </FieldLegend>
          {bots.map((bot) => (
            <SwitchField
              key={bot.id}
              label={bot.name}
              checked={botIds.includes(bot.id)}
              onCheckedChange={(checked) =>
                setBotIds((current) =>
                  checked ? [...current, bot.id] : current.filter((id) => id !== bot.id),
                )
              }
            />
          ))}
        </FieldSet>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={saving || duplicates.size > 0}>
          {saving ? <Trans>Adding…</Trans> : <Trans>Add server</Trans>}
        </Button>
      </div>
    </form>
  );
}
