export type SettingsSearchItem<Section extends string = string> = {
  /** Stable id of the element to reveal; a section's own entry leaves it out. */
  target?: string;
  section: Section;
  /** The visible, translated label. */
  label: string;
  /** Untranslated synonyms so common names still find the setting. */
  keywords?: readonly string[];
};

const MAX_RESULTS = 12;

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function words(value: string) {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Ranks settings for a query. Every query word must match a label word, a substring of the
 * label (scripts without spaces), or a keyword prefix; label matches outrank synonyms.
 */
export function searchSettings<Section extends string>(
  items: readonly SettingsSearchItem<Section>[],
  query: string,
): SettingsSearchItem<Section>[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const phrase = normalize(query.trim());
  const scored = items.flatMap((item, index) => {
    const label = normalize(item.label);
    const labelWords = words(item.label);
    const keywordWords = (item.keywords ?? []).flatMap(words);
    let score = label.startsWith(phrase) ? 4 : 0;
    for (const term of terms) {
      if (labelWords.some((word) => word.startsWith(term))) score += 3;
      else if (label.includes(term)) score += 2;
      else if (keywordWords.some((word) => word.startsWith(term))) score += 1;
      else return [];
    }
    return [{ item, index, score }];
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_RESULTS)
    .map(({ item }) => item);
}
