import { describe, expect, it } from "vitest";
import type { SettingsSearchItem } from "./settings-search";
import { searchSettings } from "./settings-search";

const items: SettingsSearchItem[] = [
  { section: "general", label: "General", keywords: ["preferences"] },
  { section: "general", target: "theme", label: "Theme", keywords: ["dark mode", "appearance"] },
  { section: "general", target: "send", label: "Send with Enter", keywords: ["keyboard"] },
  { section: "general", target: "tz", label: "Fuseau horaire", keywords: ["timezone"] },
  { section: "models", target: "backups", label: "Backup models", keywords: ["fallback"] },
  { section: "models", target: "active", label: "Active model", keywords: ["default model"] },
  { section: "general", target: "language", label: "语言", keywords: ["locale"] },
  { section: "general", target: "avatars", label: "Avatars", keywords: ["éclair"] },
];

const labels = (query: string) => searchSettings(items, query).map((item) => item.label);

describe("searchSettings", () => {
  it("returns nothing for a blank query", () => {
    expect(labels("")).toEqual([]);
    expect(labels("  ·  ")).toEqual([]);
  });

  it("matches label word prefixes regardless of case", () => {
    expect(labels("ENT")).toEqual(["Send with Enter"]);
    expect(labels("mod")).toEqual(["Backup models", "Active model", "Theme"]);
  });

  it("finds settings through untranslated synonyms", () => {
    expect(labels("dark")).toEqual(["Theme"]);
    expect(labels("timezone")).toEqual(["Fuseau horaire"]);
  });

  it("requires every query word to match", () => {
    expect(labels("backup fallback")).toEqual(["Backup models"]);
    expect(labels("backup keyboard")).toEqual([]);
  });

  it("ranks label matches above synonym-only matches", () => {
    const ranked = searchSettings(
      [
        { section: "a", target: "x", label: "Display", keywords: ["models"] },
        { section: "b", target: "y", label: "Models" },
      ],
      "models",
    );
    expect(ranked.map((item) => item.label)).toEqual(["Models", "Display"]);
  });

  it("ignores accents and matches inside labels written without spaces", () => {
    expect(labels("eclair")).toEqual(["Avatars"]);
    expect(labels("horaire")).toEqual(["Fuseau horaire"]);
    expect(labels("语")).toEqual(["语言"]);
  });

  it("keeps the original order for equal scores and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      section: "general",
      target: `row-${index}`,
      label: `Row ${index}`,
    }));
    const ranked = searchSettings(many, "row");
    expect(ranked).toHaveLength(12);
    expect(ranked[0]?.target).toBe("row-0");
    expect(ranked[11]?.target).toBe("row-11");
  });
});
