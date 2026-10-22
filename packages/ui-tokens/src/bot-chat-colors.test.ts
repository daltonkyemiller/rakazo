import { expect, it } from "vitest";
import { botChatColors, botColors, tokensForAppearance } from "./index.js";

function luminance(color: string) {
  const channels = color.startsWith("#")
    ? [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset + 1, offset + 3), 16))
    : color.match(/\d+/g)!.map(Number);
  return channels.reduce((total, channel, index) => {
    const value = channel / 255;
    return (
      total +
      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index]!
    );
  }, 0);
}

it.each(["light", "dark"] as const)(
  "keeps every bot identity readable in %s mode",
  (appearance) => {
    const surfaces = new Set<string>();
    for (const identity of [...botColors, "#FFFFFF", "#000000", "#FFFF00", "#00FF00"]) {
      const colors = botChatColors(identity, appearance);
      const values = [luminance(colors.background), luminance(colors.foreground)].sort(
        (a, b) => a - b,
      );
      expect((values[1]! + 0.05) / (values[0]! + 0.05)).toBeGreaterThanOrEqual(4.5);
      surfaces.add(colors.background);
    }
    expect(surfaces.size).toBeGreaterThan(botColors.length);
  },
);

it("uses the neutral theme surface when the chat has no valid bot color", () => {
  for (const color of [undefined, "invalid"]) {
    const palette = tokensForAppearance("dark");
    expect(botChatColors(color, "dark")).toEqual({
      background: palette.chatUser,
      foreground: palette.chatUserForeground,
    });
  }
});
