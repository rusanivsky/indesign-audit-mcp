// src/cli/report/i18n.ts
/**
 * Bilingual report strings.
 *
 * The printed report is read by two different audiences: the Ukrainian print
 * shop the job actually goes to, and anyone reading this repository in English.
 * Picking one language would have cost the other, so every visible string in
 * the report carries BOTH, and a button in the page swaps them.
 *
 * The report opens in Ukrainian: it is a working document for a Ukrainian
 * print shop first, and a published sample second. Nothing is persisted — the
 * page already tells the operator that its checkmarks live only until reload,
 * and a language that survived reload while the checkmarks did not would be a
 * lie about what the page remembers.
 */

/** A string in both languages. */
export interface Bi {
  uk: string;
  en: string;
}

/** Two languages, written out. */
export function bi(uk: string, en: string): Bi {
  return { uk, en };
}

/**
 * Text that is the same in both languages — numbers, style names, page names,
 * rule ids, colour values.
 *
 * This is NOT laziness dressed as a helper: it marks the places where a
 * translation would be WRONG, because the value comes from the user's document
 * and belongs to it, not to us. `same("Колонтитул v1")` is a style the book
 * actually declares; translating it would name a style that does not exist.
 */
export function same(s: string): Bi {
  return { uk: s, en: s };
}

/** Joins bilingual pieces, keeping each language on its own side. */
export function joinBi(parts: Bi[], separator = ""): Bi {
  return {
    uk: parts.map((p) => p.uk).join(separator),
    en: parts.map((p) => p.en).join(separator),
  };
}

/** Appends to both sides at once. */
export function concatBi(a: Bi, b: Bi): Bi {
  return { uk: a.uk + b.uk, en: a.en + b.en };
}

/** The language a freshly generated report opens in. */
export const DEFAULT_LANG = "uk" as const;
