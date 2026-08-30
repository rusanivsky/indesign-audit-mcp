import type { TypographyRule } from "./rule.js";
import type { ContainerLanguage } from "../spelling/types.js";
import { LOCALE_FAMILY, familyOf, type Locale } from "./locale.js";
import { mergedRuns } from "./langgate.js";
import { UK_RULES } from "./rules-uk.js";
import { EN_GB_RULES, EN_US_RULES } from "./rules-en.js";

/** The full rule set of a locale: the neutral core plus that school's rules. */
export function rulesFor(locale: Locale): TypographyRule[] {
  switch (locale) {
    case "uk": return UK_RULES;
    case "en-US": return EN_US_RULES;
    case "en-GB": return EN_GB_RULES;
  }
}

/** Every rule id of every locale — for the "no such rule" message. */
export function allRuleIds(): string[] {
  const seen = new Set<string>();
  for (const l of ["uk", "en-US", "en-GB"] as Locale[]) {
    for (const r of rulesFor(l)) seen.add(r.id);
  }
  return [...seen];
}

export interface ObservedLanguage {
  /** The name EXACTLY as InDesign returned it ("English: USA", "[No Language]"). */
  name: string;
  /** Family of that name ("English") — what the cross-locale skip works on. */
  family: string;
  /** How many merged ranges carry this name. */
  runs: number;
}

/**
 * Which languages are actually applied in the document.
 *
 * Exists so that A ZERO READS AS A ZERO. The gate relies on the names InDesign
 * returns in English; on a build that returns something else they would match
 * nothing, and the whole language half would silently come back empty — the same
 * class of edge already named for `usage` in Phase 5 and for `ukrainianRuns` in
 * Phase 11. Reporting the raw names makes the assumption visible instead of
 * load-bearing.
 */
export function observedLanguages(langs: ContainerLanguage[]): ObservedLanguage[] {
  const counts = new Map<string, number>();
  for (const list of mergedRuns(langs).values()) {
    for (const r of list) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, runs]) => ({ name, family: familyOf(name), runs }))
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
}

/** Families we actually have a pack for — only these can count as "foreign". */
const KNOWN_FAMILIES = new Set<string>(Object.values(LOCALE_FAMILY));

/**
 * Should cross-locale skipping engage at all for this document?
 *
 * Only when the document really carries MORE THAN ONE known family. The skip
 * exists to protect a bilingual document; on a document labelled with a single
 * family there is nothing to protect, and skipping could only discard correct
 * work.
 *
 * This guard is not defensive programming, it closes a MEASURED hazard
 * (docs/measured-facts-bilingual.md M5): a new InDesign document defaults to
 * `English: USA`, so a Ukrainian book whose typesetter never changed the language
 * is labelled English throughout. Without this guard, `locale: "uk"` on such a
 * book would find every quote and dash match inside an "English" range, skip all
 * of them, and report a confident zero — the very silent-zero cliff the
 * allow-on-unknown default was built to avoid, arriving through a language that
 * IS known.
 */
export function crossLocaleApplies(langs: ContainerLanguage[]): boolean {
  const families = new Set<string>();
  for (const list of mergedRuns(langs).values()) {
    for (const r of list) {
      const f = familyOf(r.language);
      if (KNOWN_FAMILIES.has(f)) families.add(f);
    }
  }
  return families.size > 1;
}

/**
 * Does the range lie ENTIRELY inside a language of a DIFFERENT locale?
 *
 * The soft half of the gate, and the direction of the question is the opposite
 * of `fullyInLanguage`. There the question is "is this definitely OUR language"
 * (unknown ⇒ no); here it is "is this definitely a FOREIGN one" (unknown ⇒ no).
 * That is why `[No Language]`, an unmeasured container and a document with no
 * language markup do NOT silence the rule — they merely give no grounds to skip
 * it. Reasoning in locale.ts.
 */
export function inForeignLocale(
  runs: { start: number; end: number; language: string }[] | undefined,
  start: number,
  end: number,
  locale: Locale,
): boolean {
  if (runs === undefined) return false;
  const own = LOCALE_FAMILY[locale];
  for (const r of runs) {
    if (start >= r.start && end <= r.end) {
      const fam = familyOf(r.language);
      /* A family we do not know at all ("[No Language]", "Thai") does not count
       * as foreign FOR THIS PURPOSE: skipping a match because of a language the
       * rule says nothing about would silence it on every unlabelled document. */
      if (fam !== own && KNOWN_FAMILIES.has(fam)) return true;
      return false;
    }
  }
  return false;
}
