import { describe, expect, it } from "vitest";
import {
  isMcpPlaceholderValue,
  mcpDraftServerInput,
  mcpServerLocation,
  parseMcpInput,
  splitCommandLine,
  uniqueMcpSlug,
} from "./mcp-input.js";

function servers(input: string) {
  const result = parseMcpInput(input);
  if (result.status !== "ok") throw new Error(`Expected servers, got ${JSON.stringify(result)}`);
  return result.servers;
}

describe("splitCommandLine", () => {
  it("keeps quoted arguments together without evaluating them", () => {
    expect(
      splitCommandLine(
        `npx -y "@scope/pkg@1.0" --root '/Users/me/My Files' --label "it's \\"ok\\""`,
      ),
    ).toEqual({
      ok: true,
      words: [
        "npx",
        "-y",
        "@scope/pkg@1.0",
        "--root",
        "/Users/me/My Files",
        "--label",
        `it's "ok"`,
      ],
    });
  });

  it("treats backslash escapes and line continuations like a shell", () => {
    expect(splitCommandLine("server --path My\\ Docs \\\n  --flag ''")).toEqual({
      ok: true,
      words: ["server", "--path", "My Docs", "--flag", ""],
    });
  });

  it("does not split on whitespace inside quotes the way the old form did", () => {
    const result = splitCommandLine(`uvx mcp-server-fetch --user-agent "Rakazo Bot/1.0"`);
    expect(result).toEqual({
      ok: true,
      words: ["uvx", "mcp-server-fetch", "--user-agent", "Rakazo Bot/1.0"],
    });
  });

  it.each([
    ["npx server $TOKEN"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the input under test
    ["npx server ${TOKEN}"],
    ['npx server "$(cat token)"'],
    ["npx server `whoami`"],
    ["npx server | tee log"],
    ["npx server; rm -rf /"],
    ["npx server && echo done"],
    ["npx server > out.txt"],
    ["npx server --dir ~/projects"],
    ['npx server "--token=$TOKEN"'],
  ])("refuses shell evaluation in %s", (input) => {
    expect(splitCommandLine(input)).toEqual({ ok: false, error: "shell_syntax" });
  });

  it("keeps literal dollar signs that a shell would not expand", () => {
    expect(splitCommandLine(`server --price '$5' "\\$HOME" cost$`)).toEqual({
      ok: true,
      words: ["server", "--price", "$5", "$HOME", "cost$"],
    });
  });

  it.each([[`npx "unterminated`], ["npx 'open"], ["npx trailing\\"]])(
    "reports an unterminated quote in %s",
    (input) => {
      expect(splitCommandLine(input)).toEqual({ ok: false, error: "unterminated_quote" });
    },
  );
});

describe("parseMcpInput", () => {
  it("is empty for blank input", () => {
    expect(parseMcpInput("  \n ")).toEqual({ status: "empty" });
  });

  it("reads a URL as a remote server and infers the transport", () => {
    expect(servers("https://mcp.linear.app/mcp")).toEqual([
      {
        kind: "remote",
        name: "Linear",
        endpoint: "https://mcp.linear.app/mcp",
        transport: "streamable_http",
        headers: [],
      },
    ]);
    expect(servers("https://example.test/v1/sse")[0]).toMatchObject({ transport: "sse" });
  });

  it("rejects URLs with credentials or non-HTTP schemes", () => {
    expect(parseMcpInput("https://user:pass@example.test/mcp")).toEqual({
      status: "error",
      error: "invalid_url",
    });
    expect(parseMcpInput("ftp://example.test/mcp")).toEqual({
      status: "error",
      error: "invalid_url",
    });
  });

  it("reads a command line with leading environment assignments", () => {
    expect(
      servers(
        `GITHUB_TOKEN=ghp_example API_URL="https://api.example.test" npx -y @modelcontextprotocol/server-github@1.2.0`,
      ),
    ).toEqual([
      {
        kind: "command",
        name: "Github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github@1.2.0"],
        env: [
          { name: "GITHUB_TOKEN", value: "ghp_example", missing: false },
          { name: "API_URL", value: "https://api.example.test", missing: false },
        ],
      },
    ]);
  });

  it.each([
    ["uvx mcp-server-fetch", "Fetch"],
    ["python -m mcp_server_git --repository .", "Git"],
    ["pnpm dlx @acme/weather-mcp", "Weather"],
    ["docker run -i --rm -e GITHUB_TOKEN ghcr.io/github/github-mcp-server:latest", "Github"],
    ["node /Users/me/weather/build/index.js", "Weather"],
    ["/opt/tools/notes-server --stdio", "Notes"],
  ])("names %s as %s", (input, name) => {
    expect(servers(input)[0]?.name).toBe(name);
  });

  it("connects straight to the URL behind an mcp-remote bridge", () => {
    expect(servers("npx -y mcp-remote https://mcp.example.test/sse")[0]).toMatchObject({
      kind: "remote",
      endpoint: "https://mcp.example.test/sse",
      transport: "sse",
    });
  });

  it("reads an mcpServers map with several servers", () => {
    const parsed = servers(
      JSON.stringify({
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/My Docs"],
          },
          linear: { url: "https://mcp.linear.app/sse", type: "sse" },
          notion: {
            type: "http",
            url: "https://mcp.notion.example/mcp",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the input under test
            headers: { Authorization: "Bearer ${input:notion_token}" },
          },
        },
      }),
    );
    expect(parsed).toEqual([
      {
        kind: "command",
        name: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/My Docs"],
        env: [],
      },
      {
        kind: "remote",
        name: "linear",
        endpoint: "https://mcp.linear.app/sse",
        transport: "sse",
        headers: [],
      },
      {
        kind: "remote",
        name: "notion",
        endpoint: "https://mcp.notion.example/mcp",
        transport: "streamable_http",
        headers: [{ name: "Authorization", value: "", missing: true }],
      },
    ]);
  });

  it("reads VS Code servers maps, single entries, and pasted map fragments", () => {
    expect(
      servers(
        JSON.stringify({
          servers: { git: { type: "stdio", command: "uvx", args: ["mcp-server-git"] } },
        }),
      ),
    ).toMatchObject([{ kind: "command", name: "git", command: "uvx" }]);
    expect(
      servers(JSON.stringify({ command: "node", args: ["server.js"], cwd: "/srv/mcp" })),
    ).toMatchObject([{ kind: "command", name: "Server", cwd: "/srv/mcp" }]);
    expect(
      servers(`"weather": { "serverUrl": "https://weather.example.test/mcp" },`),
    ).toMatchObject([
      { kind: "remote", name: "weather", endpoint: "https://weather.example.test/mcp" },
    ]);
  });

  it("clears placeholder credentials instead of sending them", () => {
    const [draft] = servers(
      JSON.stringify({
        mcpServers: {
          brave: {
            command: "npx",
            args: ["-y", "@brave/brave-search-mcp-server"],
            env: { BRAVE_API_KEY: "YOUR_API_KEY_HERE", REGION: "us", TOKEN: "<token>" },
          },
        },
      }),
    );
    expect(draft).toMatchObject({
      env: [
        { name: "BRAVE_API_KEY", value: "", missing: true },
        { name: "REGION", value: "us", missing: false },
        { name: "TOKEN", value: "", missing: true },
      ],
    });
  });

  it("reports malformed or empty configs", () => {
    expect(parseMcpInput('{"mcpServers": {')).toEqual({ status: "error", error: "invalid_json" });
    expect(parseMcpInput('{"mcpServers": {}}')).toEqual({ status: "error", error: "no_servers" });
    expect(parseMcpInput('{"mcpServers": {"x": {"url": "not a url"}}}')).toEqual({
      status: "error",
      error: "invalid_url",
    });
    expect(parseMcpInput("npx server $API_KEY")).toEqual({
      status: "error",
      error: "shell_syntax",
    });
  });
});

describe("isMcpPlaceholderValue", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the input under test
  it.each(["${env:TOKEN}", "<api-key>", "[TOKEN]", "your-api-key", "Bearer xxxx", "changeme"])(
    "treats %s as a placeholder",
    (value) => expect(isMcpPlaceholderValue(value)).toBe(true),
  );

  it.each(["ghp_1234", "us-east-1", "https://api.example.test", "keyboard"])("keeps %s", (value) =>
    expect(isMcpPlaceholderValue(value)).toBe(false),
  );
});

describe("mcpServerLocation", () => {
  it("labels where a server runs", () => {
    expect(mcpServerLocation({ transport: "stdio", endpoint: null })).toEqual({ kind: "server" });
    expect(
      mcpServerLocation({
        transport: "streamable_http",
        endpoint: "http://host.docker.internal:7801/mcp/host/command/a1b2c3",
      }),
    ).toEqual({ kind: "mac", host: "command" });
    expect(mcpServerLocation({ transport: "sse", endpoint: "https://mcp.linear.app/sse" })).toEqual(
      { kind: "remote", host: "mcp.linear.app" },
    );
  });
});

describe("uniqueMcpSlug", () => {
  it("adds a numeric suffix when the slug is taken", () => {
    expect(uniqueMcpSlug("github", [])).toBe("github");
    expect(uniqueMcpSlug("github", ["github", "github-2"])).toBe("github-3");
    expect(uniqueMcpSlug("x".repeat(64), ["x".repeat(64)])).toHaveLength(64);
  });
});

describe("mcpDraftServerInput", () => {
  it("builds the create payload for a remote URL or a server-run command", () => {
    const [remote] = servers("https://mcp.linear.app/sse");
    const [command] = servers(`npx -y notes-mcp --vault "/srv/My Notes"`);
    if (!remote || !command) throw new Error("Expected drafts");
    expect(
      mcpDraftServerInput(remote, { slug: "linear", name: "Linear", values: { "X-Team": "a" } }),
    ).toEqual({
      slug: "linear",
      name: "Linear",
      transport: "sse",
      endpoint: "https://mcp.linear.app/sse",
      headers: { "X-Team": "a" },
      enabled: true,
    });
    expect(
      mcpDraftServerInput(command, { slug: "notes", name: "Notes", values: { TOKEN: "t" } }),
    ).toEqual({
      slug: "notes",
      name: "Notes",
      transport: "stdio",
      command: "npx",
      args: ["-y", "notes-mcp", "--vault", "/srv/My Notes"],
      env: { TOKEN: "t" },
      enabled: true,
    });
  });
});
