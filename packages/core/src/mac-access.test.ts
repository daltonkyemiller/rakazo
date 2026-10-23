import { describe, expect, it } from "vitest";
import {
  grantMacAccess,
  isMacComputerServer,
  macComputerServers,
  revokeMacAccess,
} from "./mac-access.js";

const remote = (endpoint: string | null) => ({ transport: "streamable_http", endpoint });

describe("isMacComputerServer", () => {
  it("recognizes the desktop app's computer endpoint", () => {
    expect(
      isMacComputerServer(remote("http://host.docker.internal:4555/mcp/host/computer/abc123")),
    ).toBe(true);
  });

  it("ignores command servers, other paths, stdio, and unparsable endpoints", () => {
    expect(
      isMacComputerServer(remote("http://host.docker.internal:4555/mcp/host/command/abc123")),
    ).toBe(false);
    expect(isMacComputerServer(remote("https://example.test/mcp/host/computer/"))).toBe(false);
    expect(isMacComputerServer(remote("https://example.test/mcp"))).toBe(false);
    expect(isMacComputerServer(remote("not a url"))).toBe(false);
    expect(isMacComputerServer({ transport: "stdio", endpoint: null })).toBe(false);
  });

  it("selects only Mac computer servers from a list", () => {
    const mac = { id: "mac", ...remote("http://host.docker.internal:1/mcp/host/computer/x") };
    const other = { id: "other", ...remote("https://example.test/mcp") };
    expect(macComputerServers([other, mac]).map((server) => server.id)).toEqual(["mac"]);
  });
});

describe("Mac access assignments", () => {
  const existing = [
    { serverId: "github", allowAllTools: false, allowedTools: ["search"] },
    { serverId: "linear", allowAllTools: true, allowedTools: [] },
  ];

  it("adds Mac access without replacing other assignments or their tool limits", () => {
    expect(grantMacAccess(existing, "mac")).toEqual([
      ...existing,
      { serverId: "mac", allowAllTools: true, allowedTools: [] },
    ]);
  });

  it("keeps an existing Mac assignment as it was", () => {
    const limited = [...existing, { serverId: "mac", allowAllTools: false, allowedTools: ["x"] }];
    expect(grantMacAccess(limited, "mac")).toEqual(limited);
  });

  it("removes every Mac assignment and nothing else", () => {
    const withMacs = [
      ...existing,
      { serverId: "mac-a", allowAllTools: true, allowedTools: [] },
      { serverId: "mac-b", allowAllTools: true, allowedTools: [] },
    ];
    expect(revokeMacAccess(withMacs, ["mac-a", "mac-b"])).toEqual(existing);
  });
});
