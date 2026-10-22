import type { BrowserWindow } from "electron";
import { nativeTheme } from "electron";
import { browserWindowOptions } from "./window-options.js";

export function supportsNativeGlass(
  platform: NodeJS.Platform,
  systemVersion: string,
  reducedTransparency: boolean,
  highContrast: boolean,
) {
  return (
    platform === "darwin" &&
    Number.parseInt(systemVersion, 10) >= 26 &&
    !reducedTransparency &&
    !highContrast
  );
}

export function installNativeGlass(win: BrowserWindow, systemVersion: string) {
  const sync = () => {
    const enabled = supportsNativeGlass(
      "darwin",
      systemVersion,
      nativeTheme.prefersReducedTransparency,
      nativeTheme.shouldUseHighContrastColors,
    );
    // A window backdrop must not refract the renderer's messages and avatars as glass controls.
    win.setVibrancy(enabled ? "under-window" : null);
    win.setBackgroundColor(enabled ? "#00000000" : browserWindowOptions("darwin").backgroundColor);
    void win.webContents
      .executeJavaScript(
        `document.documentElement.toggleAttribute("data-native-glass", ${enabled})`,
      )
      .catch(() => undefined);
  };
  win.setWindowButtonVisibility(true);
  win.webContents.on("did-finish-load", sync);
  nativeTheme.on("updated", sync);
  win.once("closed", () => nativeTheme.removeListener("updated", sync));
}
