/**
 * Locale of a typographic convention — WHICH HOUSE STYLE a rule expresses.
 *
 * This is deliberately NOT the same field as `TypographyRule.language`, and the
 * difference is the whole point of the module:
 *
 * - `language` is a HARD gate. A rule bound to it rewrites orthography, and
 *   orthography applied to another language DESTROYS the text: «проект» is a
 *   correct Russian word, and rewriting it inside a Russian quotation spoils it
 *   silently. Unknown language must therefore mean DENY, and `scanContainers`
 *   throws when the ranges are missing (Phase 11, spec §7).
 *
 * - `locale` is a SOFT selector. Quotes and the parenthetical dash are a house
 *   convention, not a fact about the words: choosing the wrong one gives the
 *   wrong STYLE, not corrupted text, and the operator states which one they want
 *   by picking the pack. Unknown language must therefore mean ALLOW — otherwise
 *   the rule goes silent on every document InDesign has not labelled, which is
 *   the same cliff already named for `UK_LANGUAGE` in langgate.ts.
 *
 * Merging the two fields would force one default onto both, and either default
 * is wrong for the other half.
 */

export type Locale = "uk" | "en-US" | "en-GB";

export const LOCALES: Locale[] = ["uk", "en-US", "en-GB"];

/**
 * Language FAMILY a locale belongs to, in InDesign's own English naming.
 *
 * MEASURED on InDesign 21.5.1.73 (2026-08-25) via `app.languagesWithVendors` —
 * 61 names, among them:
 *
 *     [No Language]      English: UK          English: USA Medical
 *     Ukrainian          English: USA         English: USA Legal
 *                        English: Canadian
 *
 * Two conclusions that were not visible without the measurement. First, there
 * are FIVE English names, not two: a gate on the literal "English: USA" would
 * have gone silent on `English: USA Medical` and `English: USA Legal`. Second,
 * `[No Language]` is a real value, not an absence; it is its own family and
 * matches no locale, so a cross-locale skip can NEVER fire on it — which is the
 * allow-on-unknown default doing its job, not a special case.
 *
 * `app.languages` DOES NOT EXIST: "Object does not support the property or
 * method 'languages'". The collection to read is `languagesWithVendors`.
 *
 * `English: Canadian` deliberately does NOT auto-select a school: Canadian
 * practice mixes British spelling with American punctuation, so a guess would be
 * worse than asking. The operator picks the school; the audit only REPORTS which
 * English regions it saw.
 */
export const LOCALE_FAMILY: Record<Locale, string> = {
  uk: "Ukrainian",
  "en-US": "English",
  "en-GB": "English",
};

/**
 * Family of an InDesign language name. InDesign qualifies regional variants
 * after a colon ("English: USA", "English: UK", "Portuguese: Brazilian"), so the
 * head of the name is the family and the tail is the region.
 *
 * A name without a colon is its own family — that is what keeps "Ukrainian"
 * behaving exactly as it did before this module existed.
 */
export function familyOf(languageName: string): string {
  const colon = languageName.indexOf(":");
  return (colon === -1 ? languageName : languageName.slice(0, colon)).trim();
}

/** Do two InDesign language names belong to the same family? */
export function sameFamily(a: string, b: string): boolean {
  return familyOf(a) === familyOf(b);
}
