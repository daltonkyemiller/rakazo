import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareHostMcp } from "./host-mcp.js";

describe("private host MCP registry", () => {
  let root: string;
  let manager: Awaited<ReturnType<typeof prepareHostMcp>> | undefined;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "rakazo-mcp-registry-"));
  });
  afterEach(async () => {
    await manager?.close();
    await rm(root, { recursive: true, force: true });
  });

  it("requires an active managed instance, keeps tokens private, and persists scoped registrations", async () => {
    manager = await prepareHostMcp(root);
    await expect(manager.add({ kind: "computer", name: "Mac computer" })).rejects.toThrow(
      "managed",
    );
    await manager.activate(true);
    const first = await manager.add({ kind: "computer", name: "Mac computer" });
    const second = await manager.add({
      kind: "command",
      name: "Example",
      command: "example-mcp",
      env: { EXAMPLE_TOKEN: "fake-private-value" },
    });
    expect(first.token).not.toBe(second.token);
    expect(JSON.stringify(manager.list())).not.toContain(first.token);
    expect(JSON.stringify(manager.list())).not.toContain("fake-private-value");
    expect(second.server.envKeys).toEqual(["EXAMPLE_TOKEN"]);
    await manager.attach(first.server.id, "fake-server", "fake-space");
    expect((await stat(path.join(root, "host-mcp.json"))).mode & 0o777).toBe(0o600);
    const endpoint = first.server.endpoint;
    await manager.close();
    manager = await prepareHostMcp(root);
    expect(manager.get(first.server.id)).toMatchObject({
      endpoint,
      serverId: "fake-server",
      status: "stopped",
    });
    await expect(manager.test(first.server.id)).rejects.toThrow();
    await manager.activate(true);
    expect(await manager.test(first.server.id)).toEqual({ toolCount: 5 });
  });

  it("keeps revocation across reactivation and restart", async () => {
    manager = await prepareHostMcp(root);
    await manager.activate(true);
    const { server } = await manager.add({ kind: "computer", name: "Mac computer" });
    await manager.revoke();
    await manager.activate(false);
    await manager.activate(true);
    await expect(manager.test(server.id)).rejects.toThrow();
    await manager.close();
    manager = await prepareHostMcp(root);
    await manager.activate(true);
    expect(manager.get(server.id).enabled).toBe(false);
    await expect(manager.test(server.id)).rejects.toThrow();
    await manager.remove(server.id);
    expect(manager.list()).toEqual([]);
  });

  it("rejects unsafe saved files without overwriting them", async () => {
    const target = path.join(root, "other.json");
    await writeFile(target, "private-placeholder");
    await symlink(target, path.join(root, "host-mcp.json"));
    await expect(prepareHostMcp(root)).rejects.toThrow("safely");
    expect(await readFile(target, "utf8")).toBe("private-placeholder");
  });

  it("rejects malformed configuration and shell-shaped input", async () => {
    await writeFile(path.join(root, "host-mcp.json"), '{"version":2}');
    await expect(prepareHostMcp(root)).rejects.toThrow("invalid");
    await rm(path.join(root, "host-mcp.json"));
    manager = await prepareHostMcp(root);
    await manager.activate(true);
    await expect(
      manager.add({ kind: "command", name: "Example", command: "example", shell: true }),
    ).rejects.toThrow();
    await expect(
      manager.add({
        kind: "command",
        name: "Example",
        command: "example",
        env: { "INVALID=KEY": "fake" },
      }),
    ).rejects.toThrow();
    expect(manager.list()).toEqual([]);
  });
});
