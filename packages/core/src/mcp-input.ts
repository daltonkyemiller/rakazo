/**
 * Reads what people paste when they add an MCP server: a URL, a command line, or a client
 * config (`mcpServers`/`servers` maps or a single server entry). Parsing is deterministic and
 * offline. Command lines are split like a POSIX shell would quote them, but nothing is
 * evaluated: variables, substitutions, pipes, and redirects are rejected rather than guessed.
 */

export type McpRemoteDraft = {
  kind: "remote";
  name: string;
  endpoint: string;
  transport: "streamable_http" | "sse";
  headers: McpDraftValue[];
};

export type McpCommandDraft = {
  kind: "command";
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env: McpDraftValue[];
};

export type McpDraft = McpRemoteDraft | McpCommandDraft;

/** A named env variable or header. `missing` marks a placeholder the user must replace. */
export type McpDraftValue = { name: string; value: string; missing: boolean };

export type McpInputError =
  | "unterminated_quote"
  | "shell_syntax"
  | "invalid_json"
  | "invalid_url"
  | "no_servers";

export type McpInputParse =
  | { status: "empty" }
  | { status: "ok"; servers: McpDraft[] }
  | { status: "error"; error: McpInputError };

const MAX_INPUT_LENGTH = 64_000;

export function parseMcpInput(input: string): McpInputParse {
  const text = input.trim();
  if (!text) return { status: "empty" };
  if (text.length > MAX_INPUT_LENGTH) return { status: "error", error: "invalid_json" };
  if (text.startsWith("{") || text.startsWith('"')) return parseConfigText(text);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/\s/.test(text)) {
    const remote = remoteDraft(text, {});
    return remote ? { status: "ok", servers: [remote] } : { status: "error", error: "invalid_url" };
  }
  const split = splitCommandLine(text);
  if (!split.ok) return { status: "error", error: split.error };
  const draft = commandDraft(split.words);
  return draft ? { status: "ok", servers: [draft] } : { status: "error", error: "no_servers" };
}

type SplitResult = { ok: true; words: string[] } | { ok: false; error: McpInputError };

/**
 * Split a command line into words with shell quoting rules: single quotes are literal,
 * double quotes allow `\"`, `\\`, `\$`, and `` \` `` escapes, and a backslash outside quotes
 * escapes the next character. A backslash before a newline joins lines. Anything a shell
 * would expand or interpret is refused.
 */
export function splitCommandLine(text: string): SplitResult {
  const words: string[] = [];
  let word = "";
  let started = false;
  let index = 0;
  const push = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  while (index < text.length) {
    const char = text[index] as string;
    if (char === "\\") {
      const next = text[index + 1];
      if (next === undefined) return { ok: false, error: "unterminated_quote" };
      index += 2;
      if (next === "\n") continue;
      if (next === "\r" && text[index] === "\n") {
        index += 1;
        continue;
      }
      word += next;
      started = true;
      continue;
    }
    if (char === "'") {
      const end = text.indexOf("'", index + 1);
      if (end === -1) return { ok: false, error: "unterminated_quote" };
      word += text.slice(index + 1, end);
      started = true;
      index = end + 1;
      continue;
    }
    if (char === '"') {
      index += 1;
      let closed = false;
      while (index < text.length) {
        const inner = text[index] as string;
        if (inner === '"') {
          closed = true;
          index += 1;
          break;
        }
        if (inner === "\\") {
          const next = text[index + 1];
          if (next !== undefined && '"\\$`'.includes(next)) {
            word += next;
            index += 2;
            continue;
          }
          if (next === "\n") {
            index += 2;
            continue;
          }
        }
        if (inner === "`" || (inner === "$" && /[A-Za-z_{(]/.test(text[index + 1] ?? ""))) {
          return { ok: false, error: "shell_syntax" };
        }
        word += inner;
        index += 1;
      }
      if (!closed) return { ok: false, error: "unterminated_quote" };
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      index += 1;
      continue;
    }
    if ("|&;<>()`".includes(char)) return { ok: false, error: "shell_syntax" };
    if (char === "$" && /[A-Za-z_{(]/.test(text[index + 1] ?? "")) {
      return { ok: false, error: "shell_syntax" };
    }
    if (char === "~" && !started) return { ok: false, error: "shell_syntax" };
    word += char;
    started = true;
    index += 1;
  }
  push();
  return { ok: true, words };
}

const ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

function commandDraft(words: string[]): McpDraft | null {
  const env: McpDraftValue[] = [];
  let start = 0;
  // `env` is the portable way to prefix assignments; a leading `NAME=value` works too.
  if (words[0] === "env") start = 1;
  while (start < words.length && ENV_ASSIGNMENT.test(words[start] as string)) {
    const [, name = "", value = ""] = (words[start] as string).match(ENV_ASSIGNMENT) ?? [];
    env.push(draftValue(name, value));
    start += 1;
  }
  const [command, ...args] = words.slice(start);
  if (!command) return null;
  const remote = mcpRemoteProxyTarget(command, args);
  if (remote && env.length === 0) {
    const draft = remoteDraft(remote, {});
    if (draft) return draft;
  }
  return { kind: "command", name: commandName(command, args), command, args, env };
}

/** `npx -y mcp-remote https://…` only bridges a remote server; connect to it directly. */
function mcpRemoteProxyTarget(command: string, args: string[]): string | null {
  if (!["npx", "bunx", "pnpx"].includes(stripExtension(basename(command)))) return null;
  const rest = args.filter((arg) => arg !== "-y" && arg !== "--yes");
  if (rest.length !== 2) return null;
  const [pkg = "", url = ""] = rest;
  if (pkg !== "mcp-remote" && !pkg.startsWith("mcp-remote@")) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Package runners, and the flags of theirs that take a value before the package name. */
const RUNNER_VALUE_FLAGS: Record<string, string[]> = {
  npx: ["-p", "--package", "--registry", "--cache"],
  pnpx: [],
  bunx: [],
  uvx: ["--from", "--with", "--python", "--index-url"],
  node: ["-r", "--require", "--import"],
  python: ["-W", "-X"],
  python3: ["-W", "-X"],
};

/** Runners whose package comes after a subcommand, with value flags in that position. */
const SUBCOMMAND_RUNNERS: Record<string, { subcommands: string[]; valueFlags: string[] }> = {
  pnpm: { subcommands: ["dlx"], valueFlags: ["--package"] },
  yarn: { subcommands: ["dlx"], valueFlags: ["--package"] },
  bun: { subcommands: ["x", "run"], valueFlags: [] },
  uv: { subcommands: ["run"], valueFlags: ["--from", "--with", "--python", "--directory"] },
  pipx: { subcommands: ["run"], valueFlags: ["--spec"] },
  deno: { subcommands: ["run"], valueFlags: ["--config", "--import-map"] },
  docker: {
    subcommands: ["run"],
    valueFlags: ["-e", "--env", "-v", "--volume", "--name", "--network", "-p", "--publish", "-w"],
  },
};

/** A readable default name: the package or image a runner starts, else the command itself. */
function commandName(command: string, args: string[]): string {
  const runner = stripExtension(basename(command)).toLowerCase();
  const sub = SUBCOMMAND_RUNNERS[runner];
  let candidates: string[];
  let valueFlags: string[];
  if (sub) {
    if (!sub.subcommands.includes(args[0] ?? "")) return humanizeName(runner);
    candidates = args.slice(1);
    valueFlags = sub.valueFlags;
  } else if (runner in RUNNER_VALUE_FLAGS) {
    candidates = args;
    valueFlags = RUNNER_VALUE_FLAGS[runner] ?? [];
  } else {
    return humanizeName(runner);
  }
  for (let index = 0; index < candidates.length; index += 1) {
    const arg = candidates[index] as string;
    // `python -m package_name` names the module directly.
    if (arg === "-m" && runner.startsWith("python")) {
      const module = candidates[index + 1];
      return humanizeName(module ? packageName(module) : runner);
    }
    if (arg.startsWith("-")) {
      if (valueFlags.includes(arg)) index += 1;
      continue;
    }
    return humanizeName(packageName(arg));
  }
  return humanizeName(runner);
}

const GENERIC_SEGMENTS = new Set([
  "index",
  "main",
  "server",
  "cli",
  "dist",
  "build",
  "src",
  "bin",
  "lib",
]);

function packageName(spec: string): string {
  let name = spec;
  // npm: @scope/name@version, PyPI: name==1.0 or name[extra], image: registry/org/name:tag
  if (name.startsWith("@")) name = name.slice(1);
  name = name.replace(/@[^/]*$/, "").replace(/(==|>=|~=|\[).*$/, "");
  name = name.replace(/:[^/]*$/, "");
  name = name.replace(/^(jsr|npm):/, "");
  // A script path names its project, not its entry file: `weather/build/index.js` is "weather".
  const segments = name
    .split(/[\\/]/)
    .filter(Boolean)
    .map(stripExtension)
    .filter((segment, index, all) => index === all.length - 1 || !GENERIC_SEGMENTS.has(segment));
  const last = segments.pop() ?? name;
  return GENERIC_SEGMENTS.has(last) && segments.length > 0 ? (segments.pop() ?? last) : last;
}

function humanizeName(raw: string): string {
  const trimmed = raw
    .replace(/^(mcp[-_]server|server[-_]mcp|mcp|server)[-_]/i, "")
    .replace(/[-_](mcp[-_]server|server[-_]mcp|mcp|server)$/i, "");
  const words = (trimmed || raw).split(/[-_.\s]+/).filter(Boolean);
  if (words.length === 0) return "MCP server";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function stripExtension(name: string): string {
  return name.replace(/\.(js|mjs|cjs|ts|py|exe|cmd|sh)$/i, "");
}

/** A readable default name from a URL: `mcp.linear.app` reads as "Linear". */
function remoteName(url: URL): string {
  const labels = url.hostname.split(".").filter(Boolean);
  const meaningful = labels.filter(
    (label, index) =>
      index < labels.length - 1 && !["www", "mcp", "api", "app", "server"].includes(label),
  );
  const pick = meaningful.at(-1) ?? labels[0] ?? "";
  if (!pick || /^\d+$/.test(pick) || pick === "localhost") return "MCP server";
  return humanizeName(pick);
}

function remoteDraft(endpoint: string, headers: Record<string, unknown>): McpRemoteDraft | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return null;
  }
  return {
    kind: "remote",
    name: remoteName(url),
    endpoint,
    transport: /\/sse\/?$/i.test(url.pathname) ? "sse" : "streamable_http",
    headers: draftValues(headers),
  };
}

/** Values a docs snippet uses in place of a real credential; never sent as-is. */
export function isMcpPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  return (
    /\$\{[^}]*\}/.test(trimmed) ||
    /^<[^<>]+>$/.test(trimmed) ||
    /^\[[^[\]]+\]$/.test(trimmed) ||
    /^(Bearer\s+)?(your|my)[-_ ]?[a-z0-9_ -]*(token|key|secret|password|id)([-_ ]?here)?$/i.test(
      trimmed,
    ) ||
    /^(Bearer\s+)?(xxx+|\.\.\.|…|changeme|replace[-_ ]?me|todo)$/i.test(trimmed)
  );
}

function draftValue(name: string, value: string): McpDraftValue {
  const missing = isMcpPlaceholderValue(value);
  return { name, value: missing ? "" : value, missing };
}

function draftValues(record: Record<string, unknown>): McpDraftValue[] {
  return Object.entries(record)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([name, value]) => draftValue(name, String(value)));
}

function parseConfigText(text: string): McpInputParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Docs often show one entry of a larger map: `"github": { … }`.
    try {
      parsed = JSON.parse(`{${text.replace(/,\s*$/, "")}}`);
    } catch {
      return { status: "error", error: "invalid_json" };
    }
  }
  if (!isRecord(parsed)) return { status: "error", error: "invalid_json" };
  const servers = configServers(parsed);
  if (servers === "invalid_url") return { status: "error", error: "invalid_url" };
  return servers.length > 0 ? { status: "ok", servers } : { status: "error", error: "no_servers" };
}

function configServers(config: Record<string, unknown>): McpDraft[] | "invalid_url" {
  const nested =
    config.mcpServers ?? config.servers ?? (isRecord(config.mcp) ? config.mcp.servers : undefined);
  if (isRecord(nested)) return entryMap(nested);
  if (isServerEntry(config)) {
    const draft = entryDraft(typeof config.name === "string" ? config.name : null, config);
    return draft === "invalid_url" ? draft : draft ? [draft] : [];
  }
  return entryMap(config);
}

function entryMap(map: Record<string, unknown>): McpDraft[] | "invalid_url" {
  const drafts: McpDraft[] = [];
  for (const [name, entry] of Object.entries(map)) {
    if (!isRecord(entry) || !isServerEntry(entry)) continue;
    const draft = entryDraft(name, entry);
    if (draft === "invalid_url") return draft;
    if (draft) drafts.push(draft);
  }
  return drafts;
}

function isServerEntry(entry: Record<string, unknown>): boolean {
  return (
    typeof entry.command === "string" ||
    typeof entry.url === "string" ||
    typeof entry.serverUrl === "string"
  );
}

function entryDraft(
  name: string | null,
  entry: Record<string, unknown>,
): McpDraft | "invalid_url" | null {
  const url = typeof entry.url === "string" ? entry.url : entry.serverUrl;
  if (typeof url === "string") {
    const draft = remoteDraft(url, isRecord(entry.headers) ? entry.headers : {});
    if (!draft) return "invalid_url";
    const type = String(entry.type ?? entry.transport ?? "").toLowerCase();
    if (type === "sse") draft.transport = "sse";
    else if (type.includes("http")) draft.transport = "streamable_http";
    if (name?.trim()) draft.name = name.trim();
    return draft;
  }
  if (typeof entry.command !== "string" || !entry.command.trim()) return null;
  const args = Array.isArray(entry.args)
    ? entry.args.filter((arg) => typeof arg === "string" || typeof arg === "number").map(String)
    : [];
  const draft: McpCommandDraft = {
    kind: "command",
    name: name?.trim() || commandName(entry.command, args),
    command: entry.command,
    args,
    env: isRecord(entry.env) ? draftValues(entry.env) : [],
  };
  if (typeof entry.cwd === "string" && entry.cwd.trim()) draft.cwd = entry.cwd;
  return draft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * MCP servers the desktop app runs on a Mac are reached through an app-managed endpoint.
 * This only labels where a server runs; it never grants or implies access.
 */
const HOST_MCP_PATH = /\/mcp\/host\/(command|computer)\/[^/]+\/?$/;

export type McpServerLocation =
  | { kind: "server" }
  | { kind: "mac"; host: "command" | "computer" }
  | { kind: "remote"; host: string };

export function mcpServerLocation(server: {
  transport: string;
  endpoint: string | null;
}): McpServerLocation {
  if (server.transport === "stdio" || !server.endpoint) return { kind: "server" };
  try {
    const url = new URL(server.endpoint);
    const match = url.pathname.match(HOST_MCP_PATH);
    if (match) return { kind: "mac", host: match[1] as "command" | "computer" };
    return { kind: "remote", host: url.host };
  } catch {
    return { kind: "remote", host: server.endpoint };
  }
}

/** A slug unlike any taken one, so adding "GitHub" twice does not collide. */
export function uniqueMcpSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, 64 - String(suffix).length - 1)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * The create payload for a draft that Rakazo's server reaches: a remote URL directly, or a
 * command run as a stdio server. `values` are the confirmed headers or environment variables.
 */
export function mcpDraftServerInput(
  draft: McpDraft,
  input: {
    slug: string;
    name: string;
    values: Record<string, string>;
    transport?: McpRemoteDraft["transport"];
  },
) {
  if (draft.kind === "remote") {
    return {
      slug: input.slug,
      name: input.name,
      transport: input.transport ?? draft.transport,
      endpoint: draft.endpoint,
      headers: input.values,
      enabled: true,
    };
  }
  return {
    slug: input.slug,
    name: input.name,
    transport: "stdio" as const,
    command: draft.command,
    args: draft.args,
    env: input.values,
    enabled: true,
  };
}
