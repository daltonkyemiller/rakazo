import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { nativeTheme } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { installNativeGlass, supportsNativeGlass } from "./native-glass.js";

const state = vi.hoisted(() => ({ reduced: false, contrast: false }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const theme = new EventEmitter();
  Object.defineProperties(theme, {
    prefersReducedTransparency: { get: () => state.reduced },
    shouldUseHighContrastColors: { get: () => state.contrast },
  });
  return { nativeTheme: theme };
});

beforeEach(() => {
  state.reduced = false;
  state.contrast = false;
  nativeTheme.removeAllListeners();
});

it("uses glass only on supported Macs with transparency and normal contrast", () => {
  expect(supportsNativeGlass("darwin", "26.1", false, false)).toBe(true);
  for (const platform of ["win32", "linux"] as const)
    expect(supportsNativeGlass(platform, "27.0", false, false)).toBe(false);
  expect(supportsNativeGlass("darwin", "15.6", false, false)).toBe(false);
  expect(supportsNativeGlass("darwin", "invalid", false, false)).toBe(false);
  expect(supportsNativeGlass("darwin", "27.0", true, false)).toBe(false);
  expect(supportsNativeGlass("darwin", "27.0", false, true)).toBe(false);
});

function windowDouble() {
  const win = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { executeJavaScript: vi.fn(async () => {}) }),
    getNativeWindowHandle: () => Buffer.alloc(8),
    setBackgroundColor: vi.fn(),
    setVibrancy: vi.fn(),
    setWindowButtonVisibility: vi.fn(),
  });
  // This test double supplies just the BrowserWindow boundary used by the adapter.
  return { win, boundary: win as unknown as BrowserWindow };
}

it("uses window vibrancy without glass control refraction and honors accessibility", () => {
  const { win, boundary } = windowDouble();
  installNativeGlass(boundary, "27.0");
  win.webContents.emit("did-finish-load");
  expect(win.setVibrancy).toHaveBeenLastCalledWith("under-window");
  expect(win.webContents.executeJavaScript).toHaveBeenLastCalledWith(
    expect.stringContaining('"data-native-glass", true'),
  );
  state.reduced = true;
  nativeTheme.emit("updated");
  expect(win.setVibrancy).toHaveBeenLastCalledWith(null);
  expect(win.setBackgroundColor).not.toHaveBeenLastCalledWith("#00000000");
  expect(win.webContents.executeJavaScript).toHaveBeenLastCalledWith(
    expect.stringContaining('"data-native-glass", false'),
  );
  state.reduced = false;
  nativeTheme.emit("updated");
  expect(win.setVibrancy).toHaveBeenLastCalledWith("under-window");
  win.emit("closed");
  expect(nativeTheme.listenerCount("updated")).toBe(0);
});
