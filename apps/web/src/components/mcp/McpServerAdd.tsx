import { t } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { Bot, IntegrationCatalogSurface, McpServer } from "@rakazo/contracts";
import type { McpDraft, McpInputError } from "@rakazo/core";
import { deriveMcpSlug, mcpDraftServerInput, parseMcpInput, uniqueMcpSlug } from "@rakazo/core";
import {
  Button,
  cn,
  Disclosure,
  Field,
  FieldError,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  RadioGroup,
  RadioGroupItem,
  Textarea,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@rakazo/ui-web";
import { FileText, Globe, Laptop, Layers, Plus, Server, SquareTerminal, X } from "lucide-react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { mcpOAuthRedirectUri } from "../../lib/mcp-connect";
import type { HostMcpState } from "../../lib/mcp-host";
import { addHostMcpServer, HostMcpCleanupError } from "../../lib/mcp-host";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { McpAgentAccess } from "./McpAgentAccess";

type Row = { id: number; name: string; value: string; file: boolean; missing: boolean };

/** How a server proves who is calling: a browser sign-in it asks for, a token, or an OAuth app. */
type AuthMode = "browser" | "none" | "token" | "oauth";

let nextRowId = 0;
const emptyRow = (): Row => ({ id: nextRowId++, name: "", value: "", file: false, missing: false });

const sectionTitle = "text-[13px] font-medium text-muted-foreground";

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

function draftSource(draft: McpDraft): string {
  return draft.kind === "remote" ? draft.endpoint : [draft.command, ...draft.args].join(" ");
}

/** A single-line URL or command continues on Enter; a config keeps Enter for new lines. */
function continuesOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, source: string) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return false;
  if (event.metaKey || event.ctrlKey) return true;
  const text = source.trim();
  return !text.includes("\n") && !/^[{"]/.test(text);
}

const submitShortcut =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘↵" : "Ctrl ↵";

/** The add page's frame: content scrolls in a readable column above a fixed action bar. */
function AddLayout({ body, footer }: { body: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="rk-scroll flex-1 overflow-y-auto px-7 pt-4 pb-8">
        <div className="mx-auto w-full max-w-[34rem] space-y-7">{body}</div>
      </div>
      <div className="border-t border-border px-7 py-3">
        <div className="mx-auto flex min-h-9 w-full max-w-[34rem] items-center justify-end gap-3">
          {footer}
        </div>
      </div>
    </div>
  );
}

/**
 * Source-first setup: paste a URL, a command line, or a client config, then review only what
 * that source needs. Credentials arrive in password fields and placeholders from docs are
 * cleared, never sent.
 */
export function McpServerAdd({
  title,
  initialSource = "",
  initialName,
  initialAuth,
  servers,
  bots,
  host,
  onAdded,
}: {
  title: ReactNode;
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
  const [source, setSource] = useState(initialSource);
  const parsed = useMemo(() => parseMcpInput(source), [source]);
  const [stage, setStage] = useState<"source" | "review">(() =>
    parsed.status === "ok" ? "review" : "source",
  );
  const [touched, setTouched] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [added, setAdded] = useState<number[]>([]);
  const pasted = useRef(false);
  const drafts = parsed.status === "ok" ? parsed.servers : [];
  const index = drafts.length === 1 ? 0 : chosen;
  const draft = index === null ? undefined : drafts[index];
  const parseError = touched && parsed.status === "error" ? inputErrorText(parsed.error) : null;

  /** Reads the field's own value, so a key pressed right after an edit sees that edit. */
  function review(text = source) {
    setTouched(true);
    if (parseMcpInput(text).status !== "ok") return;
    setSource(text);
    setStage("review");
  }

  if (stage === "source") {
    return (
      <AddLayout
        body={
          <>
            {title}
            <Field data-invalid={parseError ? true : undefined}>
              <FieldLabel htmlFor={sourceId}>
                <Trans>URL, command, or config</Trans>
              </FieldLabel>
              <Textarea
                id={sourceId}
                value={source}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-invalid={parseError ? true : undefined}
                aria-describedby={parseError ? `${sourceId}-error` : undefined}
                placeholder={'https://example.com/mcp\nnpx -y example-mcp\n{ "mcpServers": { … } }'}
                className="max-h-72 min-h-32 font-mono leading-relaxed md:text-[13px]"
                onPaste={() => {
                  pasted.current = true;
                }}
                onChange={(event) => {
                  const next = event.target.value;
                  setSource(next);
                  setChosen(null);
                  setAdded([]);
                  // A paste that reads as a server goes straight to review; typing waits for Enter.
                  if (pasted.current && parseMcpInput(next).status === "ok") setStage("review");
                  pasted.current = false;
                }}
                onBlur={() => setTouched(Boolean(source.trim()))}
                onKeyDown={(event) => {
                  const text = event.currentTarget.value;
                  if (!continuesOnEnter(event, text)) return;
                  event.preventDefault();
                  review(text);
                }}
              />
              {parseError ? <FieldError id={`${sourceId}-error`}>{parseError}</FieldError> : null}
              {drafts.length > 0 ? <Detected drafts={drafts} /> : null}
            </Field>
          </>
        }
        footer={
          <Button type="button" disabled={!source.trim()} onClick={() => review()}>
            <Trans>Continue</Trans>
          </Button>
        }
      />
    );
  }

  const picker =
    drafts.length > 1 ? (
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 id={`${sourceId}-pick`} className={sectionTitle}>
            <Trans>Choose a server</Trans>
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-me-2 text-muted-foreground"
            onClick={() => setStage("source")}
          >
            <Trans>Edit source</Trans>
          </Button>
        </div>
        <RadioGroup
          aria-labelledby={`${sourceId}-pick`}
          className="gap-0 divide-y divide-border overflow-hidden rounded-xl border border-border"
          value={chosen === null ? "" : String(chosen)}
          onValueChange={(value) => setChosen(Number(value))}
        >
          {drafts.map((entry, entryIndex) => {
            const done = added.includes(entryIndex);
            return (
              // biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control.
              <label
                key={`${entry.name}:${entryIndex}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 px-3 hover:bg-accent/50 has-disabled:cursor-default has-disabled:hover:bg-transparent"
              >
                <RadioGroupItem value={String(entryIndex)} disabled={done} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir="auto">
                  {entry.name}
                </span>
                <span
                  dir="ltr"
                  className="max-w-[45%] truncate font-mono text-xs text-muted-foreground"
                >
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
      </section>
    ) : null;

  if (!draft || index === null) {
    return (
      <AddLayout
        body={
          <>
            {title}
            {picker}
          </>
        }
        footer={
          <Button type="button" disabled>
            <Trans>Add server</Trans>
          </Button>
        }
      />
    );
  }

  return (
    <DraftForm
      key={`${source}\u0000${index}`}
      lead={
        <>
          {title}
          {picker}
        </>
      }
      draft={draft}
      autoFocus={drafts.length === 1}
      initialName={source === initialSource ? initialName : undefined}
      auth={source === initialSource ? initialAuth : undefined}
      servers={servers}
      bots={bots}
      host={host}
      onEditSource={drafts.length === 1 ? () => setStage("source") : undefined}
      onAdded={(server, botIds) => {
        const remaining = drafts.length - added.length - 1;
        if (remaining > 0) {
          setAdded((current) => [...current, index]);
          setChosen(null);
        }
        onAdded(server, botIds, remaining > 0);
      }}
    />
  );
}

/** What the source reads as, so Continue is never a guess. */
function Detected({ drafts }: { drafts: McpDraft[] }) {
  const [first] = drafts;
  if (!first) return null;
  const Icon = drafts.length > 1 ? Layers : first.kind === "remote" ? Globe : SquareTerminal;
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">
        {drafts.length > 1 ? (
          <Plural value={drafts.length} one="# server" other="# servers" />
        ) : first.kind === "remote" ? (
          <Trans>Remote server · {hostOf(first.endpoint)}</Trans>
        ) : (
          <Trans>Command · {first.command}</Trans>
        )}
      </span>
    </p>
  );
}

/** A compact segmented choice; exactly one option stays selected. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      spacing={0}
      className="w-full rounded-lg border border-border p-0.5"
      value={[value]}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next[0]);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          size="sm"
          className="flex-1 rounded-md! font-normal text-muted-foreground aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function DraftForm({
  lead,
  draft,
  autoFocus,
  initialName,
  auth,
  servers,
  bots,
  host,
  onEditSource,
  onAdded,
}: {
  lead: ReactNode;
  draft: McpDraft;
  autoFocus: boolean;
  initialName?: string;
  auth?: IntegrationCatalogSurface["auth"];
  servers: McpServer[];
  bots: Bot[];
  host: HostMcpState;
  /** Absent when a picker above already offers to edit the source. */
  onEditSource?: () => void;
  onAdded: (server: McpServer, botIds: string[]) => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const formId = `${ids}-form`;
  const command = draft.kind === "command";
  const nameRef = useRef<HTMLInputElement>(null);
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
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    if (auth?.type === "bearer" && !command) return "token";
    return command ? "none" : "browser";
  });
  const [cwd, setCwd] = useState(draft.kind === "command" ? (draft.cwd ?? "") : "");
  const [secret, setSecret] = useState("");
  const [initialAccessToken, setInitialAccessToken] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthAuthorizationServer, setOauthAuthorizationServer] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthParams, setOauthParams] = useState("");
  const [botIds, setBotIds] = useState<string[]>([]);
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (autoFocus) nameRef.current?.focus();
  }, [autoFocus]);

  // Without the desktop bridge a command can only run on the Rakazo server.
  const runsOn = command ? (host.bridge ? runsOnChoice : "server") : null;
  const onMac = runsOn === "mac";
  const showAuth = !command || runsOn === "server";
  const mode: AuthMode = showAuth ? authMode : "none";
  // A config's own working directory stays in view so it can be cleared for the server.
  const cwdInMain = draft.kind === "command" && Boolean(draft.cwd);
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

  const oauthBase =
    mode === "oauth"
      ? {
          clientId: oauthClientId.trim(),
          clientSecret: oauthClientSecret || undefined,
          scope: oauthScope.trim() || undefined,
          authorizationParams: oauthParams.trim() || undefined,
        }
      : undefined;
  let token: string | undefined;
  if (mode === "token") token = secret;
  if (mode === "oauth") token = initialAccessToken || undefined;

  async function create(slug: string, serverName: string): Promise<McpServer | null> {
    const base = mcpDraftServerInput(draft, {
      slug,
      name: serverName,
      values: entries(false),
      transport,
    });
    if (base.transport !== "stdio") {
      return rpc.mcp.servers.create({ ...base, secret: token, oauthClient: oauthBase });
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
          create: (endpoint, scopedToken) =>
            rpc.mcp.servers.create({
              slug,
              name: serverName,
              transport: "streamable_http",
              endpoint,
              secret: scopedToken,
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
      secret: token,
      oauthClient: oauthBase
        ? { ...oauthBase, authorizationServer: oauthAuthorizationServer.trim() }
        : undefined,
    });
  }

  function invalid(message: string, focusId?: string) {
    setError(message);
    if (focusId) document.getElementById(focusId)?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    const serverName = name.trim();
    if (!serverName) return invalid(t`Add a server name.`, `${ids}-name`);
    if (duplicates.size > 0) return;
    if (missingRows.length > 0) {
      setShowMissing(true);
      document.getElementById(`${ids}-value-${missingRows[0]?.id}`)?.focus();
      return;
    }
    if (command && !runsOn) return invalid(t`Choose where it runs.`);
    if (command && !onMac && cwd.trim()) {
      return invalid(t`A working directory only works on this Mac.`, `${ids}-cwd`);
    }
    if (onMac && rows.some((row) => row.file)) {
      return invalid(t`Credential files only work on the Rakazo server.`);
    }
    if (mode === "token" && !secret.trim()) {
      return invalid(t`Add an access token.`, `${ids}-secret`);
    }
    if (mode === "oauth" && !oauthClientId.trim()) {
      return invalid(t`Add a client ID.`, `${ids}-oauth-client-id`);
    }
    if (mode === "oauth" && command && !oauthAuthorizationServer.trim()) {
      return invalid(t`Add the authorization server.`, `${ids}-oauth-authorization-server`);
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

  const valuePlaceholder = onMac ? t`Stays on this Mac` : t`Stored encrypted`;

  const rowEditors = rows.map((row) => {
    const invalidValue = showMissing && row.missing && !row.value.trim();
    const errorId = `${ids}-row-error-${row.id}`;
    const visibleValue = row.value.includes("{{oauth.");
    const fileToggle = command && !onMac;
    return (
      <Field
        key={row.id}
        orientation="horizontal"
        data-invalid={duplicates.has(row.id) || invalidValue || undefined}
        className={cn(
          "grid items-start gap-2",
          fileToggle
            ? "grid-cols-[minmax(0,.8fr)_minmax(0,1fr)_auto_auto]"
            : "grid-cols-[minmax(0,.8fr)_minmax(0,1fr)_auto]",
        )}
      >
        <Input
          aria-label={t`Name`}
          aria-invalid={duplicates.has(row.id) || undefined}
          aria-describedby={duplicates.has(row.id) ? errorId : undefined}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          className={cn("font-mono md:text-xs", row.file && "col-span-2")}
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
            placeholder={row.missing ? t`Required` : valuePlaceholder}
            onChange={(event) => updateRow(row.id, { value: event.target.value })}
          />
        )}
        {fileToggle ? (
          <Toggle
            variant="outline"
            size="sm"
            className="h-8"
            pressed={row.file}
            onPressedChange={(file) => updateRow(row.id, { file })}
          >
            <FileText aria-hidden="true" />
            <Trans>File</Trans>
          </Toggle>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
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
            dir="ltr"
            className="col-span-full min-h-24 font-mono md:text-xs"
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
  });

  const addRowButton = (label: ReactNode) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ms-2 text-muted-foreground"
      onClick={() => setRows((current) => [...current, emptyRow()])}
    >
      <Plus />
      {label}
    </Button>
  );

  const oauthFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={`${ids}-oauth-client-id`}>
          <Trans>Client ID</Trans>
        </FieldLabel>
        <Input
          id={`${ids}-oauth-client-id`}
          autoComplete="off"
          spellCheck={false}
          value={oauthClientId}
          onChange={(event) => setOauthClientId(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${ids}-oauth-client-secret`}>
          <Trans>Client secret</Trans>
        </FieldLabel>
        <Input
          id={`${ids}-oauth-client-secret`}
          type="password"
          autoComplete="new-password"
          value={oauthClientSecret}
          onChange={(event) => setOauthClientSecret(event.target.value)}
          placeholder={t`Optional`}
        />
      </Field>
      {command ? (
        <Field className="sm:col-span-2">
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
          <Trans>Scopes</Trans>
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
          <Trans>Authorization parameters</Trans>
        </FieldLabel>
        <Input
          id={`${ids}-oauth-params`}
          autoComplete="off"
          value={oauthParams}
          onChange={(event) => setOauthParams(event.target.value)}
          placeholder="prompt=consent"
        />
      </Field>
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor={`${ids}-oauth-redirect-uri`}>
          <Trans>Redirect URI</Trans>
        </FieldLabel>
        <Input
          id={`${ids}-oauth-redirect-uri`}
          readOnly
          dir="ltr"
          className="font-mono text-muted-foreground md:text-xs"
          value={mcpOAuthRedirectUri()}
          onFocus={(event) => event.target.select()}
        />
      </Field>
    </div>
  );

  const authSection = showAuth ? (
    <section className="space-y-3" aria-labelledby={`${ids}-auth`}>
      <h3 id={`${ids}-auth`} className={sectionTitle}>
        <Trans>Authentication</Trans>
      </h3>
      <Segmented
        label={t`Authentication`}
        value={authMode}
        onChange={setAuthMode}
        options={[
          command
            ? { value: "none" as const, label: t`None` }
            : { value: "browser" as const, label: t`Browser sign-in` },
          { value: "token", label: t`Access token` },
          { value: "oauth", label: t`OAuth client` },
        ]}
      />
      {auth?.note ? <p className="text-xs text-muted-foreground">{auth.note}</p> : null}
      {mode === "browser" ? (
        <p className="text-xs text-muted-foreground">
          <Trans>If the server asks, you sign in from its page after adding it.</Trans>
        </p>
      ) : null}
      {mode === "token" ? (
        <Field>
          <FieldLabel htmlFor={`${ids}-secret`} className="sr-only">
            <Trans>Access token</Trans>
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
      ) : null}
      {mode === "oauth" ? oauthFields : null}
      {command ? null : (
        <div className="space-y-2 pt-1">
          {rows.length > 0 ? (
            <p className={sectionTitle}>
              <Trans>Headers</Trans>
            </p>
          ) : null}
          {rowEditors}
          {addRowButton(<Trans>Add header</Trans>)}
        </div>
      )}
    </section>
  ) : null;

  const envSection = command ? (
    <section className="space-y-2" aria-labelledby={`${ids}-env`}>
      <h3 id={`${ids}-env`} className={sectionTitle}>
        <Trans>Environment variables</Trans>
      </h3>
      {rowEditors}
      {addRowButton(<Trans>Add variable</Trans>)}
      {!onMac && mode === "oauth" ? (
        <p className="text-xs text-muted-foreground">
          <Trans>Use {"{{oauth.access_token}}"} for the access token.</Trans>
        </p>
      ) : null}
    </section>
  ) : null;

  const cwdField = (
    <Field>
      <FieldLabel htmlFor={`${ids}-cwd`}>
        <Trans>Working directory</Trans>
      </FieldLabel>
      <Input
        id={`${ids}-cwd`}
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        className="font-mono md:text-xs"
        value={cwd}
        onChange={(event) => setCwd(event.target.value)}
      />
    </Field>
  );

  const moreOptions = !command ? (
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
  ) : onMac && !cwdInMain ? (
    cwdField
  ) : null;

  const SourceIcon = command ? SquareTerminal : Globe;

  return (
    <AddLayout
      body={
        <form
          id={formId}
          data-testid="mcp-server-draft"
          className="space-y-7"
          noValidate
          onSubmit={(event) => void submit(event)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            event.currentTarget.requestSubmit();
          }}
        >
          {lead}
          <header className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-muted-foreground">
              <SourceIcon aria-hidden="true" className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor={`${ids}-name`} className="sr-only">
                <Trans>Server name</Trans>
              </label>
              <Input
                ref={nameRef}
                id={`${ids}-name`}
                value={name}
                autoComplete="off"
                dir="auto"
                className="-ms-2 h-8 border-transparent bg-transparent px-2 text-base font-medium shadow-none md:text-base hover:border-border focus-visible:border-ring dark:bg-transparent"
                onChange={(event) => setName(event.target.value)}
              />
              <p
                dir="ltr"
                title={draftSource(draft)}
                className="truncate text-start font-mono text-xs text-muted-foreground"
              >
                {draftSource(draft)}
              </p>
              {command && !host.bridge ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Server aria-hidden="true" className="size-3.5" />
                  <span>
                    <Trans>Runs on Rakazo server</Trans>
                  </span>
                </p>
              ) : null}
            </div>
            {onEditSource ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-muted-foreground"
                onClick={onEditSource}
              >
                <Trans>Edit source</Trans>
              </Button>
            ) : null}
          </header>

          {command && host.bridge ? (
            <fieldset>
              <legend className={cn(sectionTitle, "mb-2")}>
                <Trans>Runs on</Trans>
              </legend>
              <RadioGroup
                className="grid gap-2 sm:grid-cols-2"
                value={runsOnChoice ?? ""}
                onValueChange={(value) => setRunsOnChoice(value as "server" | "mac")}
              >
                {(
                  [
                    {
                      value: "server",
                      icon: Server,
                      title: <Trans>Rakazo server</Trans>,
                      detail: <Trans>Runs where Rakazo is hosted, away from this Mac.</Trans>,
                    },
                    {
                      value: "mac",
                      icon: Laptop,
                      title: <Trans>This Mac</Trans>,
                      detail: <Trans>Runs as you, with your access to files and apps.</Trans>,
                    },
                  ] as const
                ).map((option) => (
                  // biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control.
                  <label
                    key={option.value}
                    className="flex cursor-pointer gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-accent/40 has-[[data-checked]]:border-foreground/30 has-[[data-checked]]:bg-accent/50"
                  >
                    <RadioGroupItem value={option.value} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <option.icon
                          aria-hidden="true"
                          className="size-3.5 text-muted-foreground"
                        />
                        {option.title}
                      </span>
                      <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                        {option.detail}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>
          ) : null}

          {authSection}
          {envSection}
          {cwdInMain ? cwdField : null}

          <McpAgentAccess
            bots={bots}
            isAssigned={(botId) => botIds.includes(botId)}
            onChange={(botId, checked) =>
              setBotIds((current) =>
                checked ? [...current, botId] : current.filter((id) => id !== botId),
              )
            }
          />

          {moreOptions || mode === "oauth" ? (
            <Disclosure
              summary={<Trans>More options</Trans>}
              summaryClassName="text-[13px] text-muted-foreground"
            >
              <div className="space-y-4 pt-4">
                {moreOptions}
                {mode === "oauth" ? (
                  <Field>
                    <FieldLabel htmlFor={`${ids}-initial-access-token`}>
                      <Trans>Initial access token</Trans>
                    </FieldLabel>
                    <Input
                      id={`${ids}-initial-access-token`}
                      type="password"
                      autoComplete="new-password"
                      value={initialAccessToken}
                      onChange={(event) => setInitialAccessToken(event.target.value)}
                      placeholder={t`Optional`}
                    />
                  </Field>
                ) : null}
              </div>
            </Disclosure>
          ) : null}
        </form>
      }
      footer={
        <>
          {error ? (
            <p role="alert" className="me-auto min-w-0 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <span
            aria-hidden="true"
            className="hidden text-xs text-muted-foreground pointer-fine:inline"
          >
            {submitShortcut}
          </span>
          <Button type="submit" form={formId} disabled={saving || duplicates.size > 0}>
            {saving ? <Trans>Adding…</Trans> : <Trans>Add server</Trans>}
          </Button>
        </>
      }
    />
  );
}
