import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { RakazoDesktop, RakazoSetup } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";

function runPreload(file: string, ipc: { invoke?: unknown; on?: unknown; off?: unknown } = {}) {
  const invoke =
    (ipc.invoke as ReturnType<typeof vi.fn>) ?? vi.fn(async (channel: string) => ({ channel }));
  const on = (ipc.on as ReturnType<typeof vi.fn>) ?? vi.fn();
  const off = (ipc.off as ReturnType<typeof vi.fn>) ?? vi.fn();
  const exposeInMainWorld = vi.fn();
  const source = readFileSync(path.join(import.meta.dirname, file), "utf8");

  vm.runInNewContext(source, {
    process: { platform: "linux" },
    require(moduleName: string) {
      if (moduleName !== "electron") throw new Error(`Unexpected preload import: ${moduleName}`);
      return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, on, off } };
    },
  });

  return { invoke, on, off, exposeInMainWorld };
}

describe("desktop preload bridge", () => {
  it("exposes the scoped desktop bridges", async () => {
    const { invoke, exposeInMainWorld } = runPreload("preload.cjs");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [globalName, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    expect(globalName).toBe("rakazoDesktop");
    expect(bridge.platform).toBe("linux");
    expect(Object.keys(bridge).sort()).toEqual([
      "appearance",
      "badge",
      "computer",
      "mcp",
      "oauth",
      "platform",
      "settings",
      "update",
      "window",
    ]);
    expect(Object.keys(bridge.window).sort()).toEqual([
      "close",
      "minimize",
      "state",
      "toggleMaximize",
    ]);
    expect(Object.keys(bridge.update).sort()).toEqual(["check", "download", "install", "state"]);

    expect(Object.keys(bridge.badge!)).toEqual(["set"]);
    await bridge.badge!.set(7);
    expect(invoke).toHaveBeenCalledWith("desktop.badge.set", 7);

    await bridge.oauth.open?.("https://provider.example.com/authorize");
    await bridge.oauth.cancel?.("https://provider.example.com/authorize");
    await bridge.window.close();
    await bridge.window.minimize();
    await bridge.window.toggleMaximize();
    await bridge.window.state();
    await bridge.update.state();
    await bridge.update.check();
    await bridge.update.download();
    await bridge.update.install();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop.badge.set",
      "desktop.oauth.open",
      "desktop.oauth.cancel",
      "desktop.window.close",
      "desktop.window.minimize",
      "desktop.window.toggleMaximize",
      "desktop.window.state",
      "desktop.update.state",
      "desktop.update.check",
      "desktop.update.download",
      "desktop.update.install",
    ]);
  });

  it("forwards only the explicit local MCP operations", async () => {
    const { invoke, exposeInMainWorld } = runPreload("preload.cjs");
    const [, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    const input = { kind: "computer" as const, name: "Mac computer" };
    await bridge.mcp!.state();
    await bridge.mcp!.add(input);
    await bridge.mcp!.attach("local-id", "server-id", "space-id");
    await bridge.mcp!.setEnabled("local-id", false);
    await bridge.mcp!.test("local-id");
    await bridge.mcp!.remove("local-id");
    await bridge.mcp!.openPermissions!();
    expect(invoke.mock.calls).toEqual([
      ["desktop.mcp.state"],
      ["desktop.mcp.add", input],
      ["desktop.mcp.attach", "local-id", "server-id", "space-id"],
      ["desktop.mcp.setEnabled", "local-id", false],
      ["desktop.mcp.test", "local-id"],
      ["desktop.mcp.remove", "local-id"],
      ["desktop.mcp.openPermissions"],
    ]);
  });

  it("passes an appearance preference through the isolated bridge", async () => {
    const { invoke, exposeInMainWorld } = runPreload("preload.cjs");
    const [, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    await bridge.appearance!.set("dark");
    expect(invoke).toHaveBeenCalledWith("desktop.appearance.set", "dark");
  });

  it("opens server settings and subscribes to the app settings menu without exposing events", async () => {
    let handler: (() => void) | undefined;
    const on = vi.fn((_channel: string, listener: () => void) => {
      handler = listener;
    });
    const off = vi.fn();
    const { invoke, exposeInMainWorld } = runPreload("preload.cjs", { on, off });
    const [, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    const listener = vi.fn();
    const unsubscribe = bridge.settings!.onOpen(listener);
    handler!();
    expect(listener).toHaveBeenCalledWith();
    unsubscribe();
    expect(off).toHaveBeenCalledWith("desktop.settings.open", handler);
    await bridge.settings!.openServer();
    expect(invoke).toHaveBeenCalledWith("desktop.settings.openServer");
  });

  it("forwards captured codes without leaking the IPC event to the renderer", () => {
    const listeners: Array<(event: unknown, callback: unknown) => void> = [];
    const on = vi.fn((_channel: string, handler: (event: unknown, callback: unknown) => void) => {
      listeners.push(handler);
    });
    const off = vi.fn();
    const { exposeInMainWorld } = runPreload("preload.cjs", { on, off });

    const [, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    const received: unknown[] = [];
    const unsubscribe = bridge.oauth.onCallback((callback) => received.push(callback));

    expect(on).toHaveBeenCalledWith("desktop.oauth.callback", expect.any(Function));
    listeners[0]?.({ sender: "ipc-event" }, { code: "ac_123", state: "verifier_456" });
    expect(received).toEqual([{ code: "ac_123", state: "verifier_456" }]);

    unsubscribe();
    expect(off).toHaveBeenCalledWith("desktop.oauth.callback", expect.any(Function));
  });
});

describe("setup preload bridge", () => {
  it("exposes only the first-run setup operations", async () => {
    const { invoke, on, exposeInMainWorld } = runPreload("setup-preload.cjs");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [globalName, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoSetup];
    expect(globalName).toBe("rakazoSetup");
    expect(bridge.platform).toBe("linux");
    expect(Object.keys(bridge).sort()).toEqual([
      "openLink",
      "platform",
      "quit",
      "save",
      "stack",
      "state",
      "test",
    ]);
    expect(Object.keys(bridge.stack).sort()).toEqual(["onChange", "start", "state"]);

    await bridge.state();
    await bridge.test("http://127.0.0.1:5173");
    await bridge.save({ mode: "new", serverUrl: "http://127.0.0.1:5173" });
    await bridge.quit();
    await bridge.openLink("orbstack");
    await bridge.stack.state();
    await bridge.stack.start();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop.setup.state",
      "desktop.setup.test",
      "desktop.setup.save",
      "desktop.setup.quit",
      "desktop.setup.openLink",
      "desktop.setup.stack.state",
      "desktop.setup.stack.start",
    ]);
    expect(invoke).toHaveBeenCalledWith("desktop.setup.openLink", "orbstack");

    const listener = vi.fn();
    bridge.stack.onChange(listener);
    const [channel, handler] = on.mock.calls.at(-1) as [string, (...args: unknown[]) => void];
    expect(channel).toBe("desktop.setup.stack.changed");
    handler({}, { phase: "pulling" });
    expect(listener).toHaveBeenCalledWith({ phase: "pulling" });
  });
});
