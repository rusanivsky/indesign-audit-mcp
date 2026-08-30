/**
 * B1. Description of a typography rule.
 *
 * Responsibility boundary: this module and the whole src/typography/ directory do NOT know
 * about InDesign, nor about the corrector's edits. They work with strings. This is what
 * allows the largest part of the phase's logic to be covered by unit tests without InDesign.
 */

export type RuleConfidence = "high" | "needs-review";

export interface RawMatch {
  start: number;
  end: number;
  /** What to replace [start, end) with. */
  replacement: string;
}

export interface TypographyRule {
  id: string;
  /** Human-readable name — goes into the report as a group heading. */
  title: string;
  confidence: RuleConfidence;
  /**
   * The language within which the rule is allowed — InDesign's English name,
   * e.g. "Ukrainian". A missing field = no hard gate.
   *
   * The gate sits ON THE RULE, not on the pass: a spelling rule applied
   * to foreign-language text silently corrupts it — «проект» is a correct Russian
   * word.
   *
   * THIS COMMENT USED TO CLAIM that the spacing, dash and QUOTE rules were
   * "language-neutral". For quotes and dashes that WAS FALSE, measured
   * 2026-08-25: on an English sample `quotes-uk` produced «I don't know,»
   * instead of “I don't know,”, and `dialogue-dash` ate bullet lists — 8 matches
   * out of 14, all at confidence "high", meaning `typography_apply` would have
   * applied them by default (docs/measured-facts-bilingual.md M1). Fixed not by
   * this field but by `locale` — see the comment below and locale.ts.
   */
  language?: string;
  /**
   * The locale of the convention the rule expresses — "uk", "en-US", "en-GB".
   *
   * NOT THE SAME as `language`, and the two must not be merged: `language` is
   * the hard orthography gate (no ranges ⇒ REFUSE), while `locale` is the soft
   * pack selector (no ranges ⇒ ALLOW). Reasoning in src/typography/locale.ts.
   *
   * No field = the rule is language-neutral FOR REAL: spacing, apostrophe,
   * ellipsis and numeric ranges are identical in all three locales. Quotes, the
   * separator dash and the dialogue dash DO carry the field, because those are
   * exactly where the schools diverge (measured:
   * docs/measured-facts-bilingual.md M1).
   */
  locale?: import("./locale.js").Locale;
  /**
   * Finds matches. Must return them in ascending order of start and without
   * overlaps between them.
   */
  match: (text: string) => RawMatch[];
  /**
   * Lowers the confidence of a specific match to needs-review, without discarding it.
   * This is the mechanism for "questionable" matches that get confirmed one by one.
   */
  review?: (m: RawMatch, text: string) => boolean;
}

export interface RegexRuleSpec {
  id: string;
  title: string;
  confidence: RuleConfidence;
  /** The rule's language gate — see TypographyRule.language. */
  language?: string;
  /** The convention's locale — see TypographyRule.locale. */
  locale?: import("./locale.js").Locale;
  /** Must have the g and u flags. */
  find: RegExp;
  /** A string with $1..$9, or a function of the match. */
  replace: string | ((m: RegExpExecArray) => string);
  /** Returns true — the match is DISCARDED (an exception to the rule). */
  except?: (m: RegExpExecArray, text: string) => boolean;
  /** Returns true — the match stays, but as questionable. */
  review?: (m: RawMatch, text: string) => boolean;
}

function expand(template: string, m: RegExpExecArray): string {
  return template.replace(/\$(\d)/gu, (_, d: string) => m[Number(d)] ?? "");
}

/** Builds a rule from a regular expression — the form in which most rules are written. */
export function regexRule(spec: RegexRuleSpec): TypographyRule {
  if (!spec.find.global || !spec.find.unicode) {
    throw new Error(`Rule "${spec.id}": the regular expression must have the g and u flags.`);
  }
  return {
    id: spec.id,
    title: spec.title,
    confidence: spec.confidence,
    ...(spec.review ? { review: spec.review } : {}),
    ...(spec.language !== undefined ? { language: spec.language } : {}),
    ...(spec.locale !== undefined ? { locale: spec.locale } : {}),
    match(text) {
      const re = new RegExp(spec.find.source, spec.find.flags);
      const out: RawMatch[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        /* An empty match would loop exec forever — advance the position manually. */
        if (m[0].length === 0) { re.lastIndex++; continue; }
        if (spec.except?.(m, text)) continue;
        const replacement = typeof spec.replace === "string" ? expand(spec.replace, m) : spec.replace(m);
        /*
         * A MATCH THAT CHANGES NOTHING IS NOT A MATCH.
         *
         * A rule whose search class contains its own replacement character, after
         * the first normalization, matches its own output — and keeps reporting it
         * forever. MEASURED on the working book 2026-08-15: `range-dash-numeric`
         * (`HYPHENS` contains U+2013, and U+2013 is exactly what's in `replace`) gave 107
         * matches out of 131 total, and in all 50 checked `before === after`
         * byte-for-byte. The cost was twofold: the report was inflated 5.5x, and
         * `typography_apply` would have performed 107 empty edits.
         *
         * The check sits HERE, in the shared seam, not in the rule itself:
         * the same defect is latent in `range-dash-words` (the same U+2013 in the
         * output) and will appear in any future rule that
         * normalizes a character to one of the variants it searches for.
         *
         * Why 1900+ tests didn't catch this: they all check the REWRITE RESULT,
         * and an empty match gives a string identical to the input.
         * A test for this must look at the list of matches (`match`), not at the
         * text — see tests/unit/typography-rule.test.ts.
         */
        if (replacement === m[0]) continue;
        out.push({
          start: m.index,
          end: m.index + m[0].length,
          replacement,
        });
      }
      return out;
    },
  };
}
