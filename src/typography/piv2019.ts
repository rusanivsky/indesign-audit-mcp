// src/typography/piv2019.ts
/**
 * 2019 orthography, «пів» (§ 36, item 6, Note). READ-ONLY family: there is
 * neither `match` nor `replacement` here, and `typography_apply` has
 * physically nothing to apply from it. Precedent — `auditOnly()`
 * (rules-uk.ts) and `collectVariantPairs` (spelling2019.ts).
 *
 * WHY IT DOESN'T WRITE, even though the verdict can be firm: a hyphen after
 * «пів» is unconditionally wrong, but the FIX branches by noun class —
 * `пів-Києва` → `пів Києва` (separate) versus `пів-фінал` → `півфінал`
 * (joined). Choosing between two opposite fixes is impossible without
 * morphology.
 */

export interface TogetherWord {
  /** Stem in the nominative, as in the source: «піваркуш» → «аркуш». */
  nominative: string;
  /** Stem in the genitive: «піваркуша» → «аркуша». DERIVED, not from the source — see the comment above TOGETHER_WORDS. */
  genitive: string;
}

/**
 * Joined — a single concept, not «half». TEN words, transcribed verbatim
 * from the primary text, without stress marks.
 *
 * `літра` here is NOT a mistake: the orthography prints «півлітра (розм.
 * 'пляшка з горілкою або іншою випивкою ємністю 0,5 літра')». The spec
 * draft had nine words, because three secondary sources independently lost
 * exactly the part printed with a parenthetical remark.
 *
 * Genitive forms are needed for AMBIGUOUS_STEMS — and unlike the
 * nominatives, they are NOT TRANSCRIBED: Note § 36, item 6 prints only ten
 * nominatives, there is no genitive column in the source at all. Each
 * genitive below is a morphological DERIVATION from this phase, separately
 * derived and checked for each word. AMBIGUOUS_STEMS — the sole safeguard
 * against wrongly accusing correct spelling (spec §4.3) — is computed
 * entirely from this column, so an error in the derivation here silently
 * turns a correct spelling into a `wrong` verdict. When extending the list:
 * nominative is transcribed verbatim from the source; genitive is DERIVED
 * and checked separately, never copied from somewhere else.
 */
export const TOGETHER_WORDS: TogetherWord[] = [
  { nominative: "аркуш", genitive: "аркуша" },
  { nominative: "день", genitive: "дня" },
  { nominative: "захист", genitive: "захисту" },
  { nominative: "коло", genitive: "кола" },
  { nominative: "куля", genitive: "кулі" },
  { nominative: "літра", genitive: "літра" },
  { nominative: "місяць", genitive: "місяця" },
  { nominative: "оберт", genitive: "оберту" },
  { nominative: "овал", genitive: "овала" },
  { nominative: "острів", genitive: "острова" },
];

/** Separate — the numeral «пів» + noun in the genitive. Thirteen examples. */
export const SEPARATE_STEMS: string[] = [
  "аркуша",
  "відра",
  "години",
  "літра",
  "міста",
  "огірка",
  "острова",
  "яблука",
  "ящика",
  "ями",
  "європи",
  "києва",
  "україни",
];

/**
 * Stems for which a verdict is IMPOSSIBLE either way, because both spellings
 * are correct in different meanings: «мешканці півострова» and «пів острова».
 *
 * COMPUTED from the intersection of two lists, not hand-written as three
 * rows: hand-written rows would silently go stale the moment the list is
 * extended. The mechanism: the separate list is in the genitive, the joined
 * one in the nominative, and the genitive of the joined word yields the same
 * stem.
 */
export const AMBIGUOUS_STEMS: Set<string> = new Set(
  TOGETHER_WORDS.map((w) => w.genitive).filter((g) => SEPARATE_STEMS.includes(g)),
);

export type PivKind = "solid" | "separate" | "apostrophe" | "hyphen";

export interface PivRawMatch {
  /** Offset of the start of «пів». */
  start: number;
  /** Offset of the end of the stem. */
  end: number;
  kind: PivKind;
  /** Stem in lowercase. */
  stem: string;
}

/**
 * Words that start with «пів» but aren't «пів + noun». The list is CLOSED
 * and DELIBERATELY INCOMPLETE — which is exactly why the family gives no
 * verdict on anything outside the source's two lists.
 *
 * Comparison is done against the JOINED form (`пів` + stem) by prefix. The
 * exclusion doesn't apply to the separate form: `півдня` is the genitive of
 * «південь» (south), while `пів дня` is the numeral «half a day», and both
 * are correct.
 */
export const NOT_NUMERAL_PREFIXES: string[] = [
  // class 1 — not a numeral at all
  "півень",
  "півня",
  "півнем",
  "півні",
  "півник",
  "півонія",
  "півоні",
  "півча",
  // class 2 — other numerals with «пів»
  "півтори",
  "півтора",
  "півтораста",
  // class 3 — oblique forms of joined words and derivatives
  "північ",
  "південь",
  "південн",
  "півдн",
];

/**
 * Separator between «пів» and the stem. The empty branch comes LAST —
 * otherwise it would swallow the rest, since JS alternation is ordered.
 *
 * The apostrophe is TWO different characters: U+0027 from the keyboard and
 * U+2019 from typographic input. The space is also two: a plain one and the
 * non-breaking U+00A0, which the typesetter places there deliberately.
 *
 * `(?=\p{Script=Cyrillic})` requires a Cyrillic letter AFTER the separator:
 * without it «пів 2020 року» would produce a stem made of garbage. There's
 * no `i` flag — the case of «пів» is spelled out explicitly as `[пП]`.
 */
/* Classes are written as CODES, not literal characters: the non-breaking
 * space and the typographic apostrophe are invisible in the editor, and a
 * silent substitution with plain ones would break the pattern with no
 * visible change in the diff. */
const PIV =
  /(?<![\p{L}\p{N}])[\u043F\u041F]ів(['\u2019]|-|[\u0020\u00A0]|)(?=\p{Script=Cyrillic})/gu;

/** Letters of the stem, including an internal apostrophe («пів з'їзду»). */
const STEM_TAIL = /^[\p{L}'\u2019]+/u;

function kindOf(sep: string): PivKind {
  if (sep === "'" || sep === "\u2019") return "apostrophe";
  if (sep === "-") return "hyphen";
  if (sep === "" ) return "solid";
  return "separate";
}

export function matchPivForms(text: string): {
  matches: PivRawMatch[];
  excludedNotNumeral: number;
} {
  const matches: PivRawMatch[] = [];
  let excludedNotNumeral = 0;

  PIV.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PIV.exec(text)) !== null) {
    const sep = m[1] ?? "";
    const kind = kindOf(sep);
    const tail = STEM_TAIL.exec(text.slice(m.index + m[0].length));
    if (tail === null) continue;
    const stem = tail[0].toLocaleLowerCase("uk");

    if (kind === "solid") {
      const word = `пів${stem}`;
      if (NOT_NUMERAL_PREFIXES.some((p) => word.startsWith(p))) {
        excludedNotNumeral++;
        continue;
      }
    }

    matches.push({
      start: m.index,
      end: m.index + m[0].length + tail[0].length,
      kind,
      stem,
    });
  }

  return { matches, excludedNotNumeral };
}

export type PivReason =
  /** An apostrophe or hyphen after «пів» — the 2019 norm has neither at all. */
  | "pre-reform-mark"
  /** The stem is in the source list, the spelling contradicts the list. */
  | "contradicts-list"
  /** The stem is in the list, the spelling MATCHES it. This is not an error. */
  | "matches-list"
  /** The stem is outside both lists — there is no verdict in principle. */
  | "not-in-lists";

const TOGETHER_NOMINATIVE = new Set(TOGETHER_WORDS.map((w) => w.nominative));
const SEPARATE_SET = new Set(SEPARATE_STEMS);

/**
 * `reason` is an ENUMERATED type, not a free string: a free string would be
 * a loophole through which a third verdict class could sneak back in under
 * a different name.
 *
 * The order of checks matters. The pre-reform marker comes FIRST and
 * overrides even ambiguous stems: `пів-острова` is wrong even though both
 * `півострова` and `пів острова` are correct — because it's the HYPHEN
 * itself that's wrong, not the choice of spelling.
 */
export function classifyStem(
  stem: string,
  kinds: Set<PivKind>,
): { verdict: "wrong" | "inventory"; reason: PivReason } {
  if (kinds.has("apostrophe") || kinds.has("hyphen")) {
    return { verdict: "wrong", reason: "pre-reform-mark" };
  }

  if (AMBIGUOUS_STEMS.has(stem)) {
    return { verdict: "inventory", reason: "matches-list" };
  }

  if (SEPARATE_SET.has(stem)) {
    return kinds.has("solid")
      ? { verdict: "wrong", reason: "contradicts-list" }
      : { verdict: "inventory", reason: "matches-list" };
  }

  if (TOGETHER_NOMINATIVE.has(stem)) {
    return kinds.has("separate")
      ? { verdict: "wrong", reason: "contradicts-list" }
      : { verdict: "inventory", reason: "matches-list" };
  }

  return { verdict: "inventory", reason: "not-in-lists" };
}

import type { ContainerSnapshot } from "../corrections/types.js";
import type { ContainerLanguage } from "../spelling/types.js";
import { comparePageNames, MAX_PAGES_LISTED } from "../spelling/types.js";
import { fullyInLanguage, mergedRuns } from "./langgate.js";

export interface PivFormCount {
  kind: PivKind;
  count: number;
  /** The first MAX_PAGES_LISTED pages, ORDERED. Total count is in pageCount. */
  pages: string[];
  pageCount: number;
}

export interface PivStemFinding {
  stem: string;
  verdict: "wrong" | "inventory";
  reason: PivReason;
  forms: PivFormCount[];
  mixed: boolean;
}

const KIND_ORDER: PivKind[] = ["solid", "separate", "apostrophe", "hyphen"];

/**
 * Fallback is the LAST page (`.at(-1)`), the same choice as in
 * spelling2019.ts and corrections/planner.ts: language runs cover the FULL
 * story text including overset, while pageRuns only sees placed frames, so
 * invisible text logically continues the LAST visible page.
 */
function pageAt(c: ContainerSnapshot, offset: number): string {
  for (const r of c.pageRuns) if (offset >= r.start && offset < r.end) return r.page;
  return c.pageRuns.at(-1)?.page ?? "?";
}

/**
 * The gate is `fullyInLanguage`, NOT slicing by run (as in
 * `collectVariantPairs`). This family searches for a PATTERN, and a match of
 * «пів + separator + noun» can easily straddle a run boundary — an italic
 * insertion, a changed language attribute on a single word. Rejected matches
 * do occur, so they're counted: the same argument by which
 * excludedNotNumeral is counted.
 */
export function collectPivStems(
  containers: ContainerSnapshot[],
  langs: ContainerLanguage[],
  language: string,
): {
  stems: PivStemFinding[];
  wrongCount: number;
  mixedCount: number;
  skippedByLanguage: number;
  excludedNotNumeral: number;
} {
  const runsById = mergedRuns(langs);
  const acc = new Map<
    string,
    Map<PivKind, { count: number; pages: string[]; seen: Set<string> }>
  >();
  let skippedByLanguage = 0;
  let excludedNotNumeral = 0;

  for (const c of containers) {
    if (c.isMaster) continue;
    const runs = runsById.get(c.containerId);
    const found = matchPivForms(c.text);
    excludedNotNumeral += found.excludedNotNumeral;

    for (const m of found.matches) {
      if (!fullyInLanguage(runs, m.start, m.end, language)) {
        skippedByLanguage++;
        continue;
      }
      const byKind = acc.get(m.stem) ?? new Map();
      acc.set(m.stem, byKind);
      const cell = byKind.get(m.kind) ?? { count: 0, pages: [], seen: new Set<string>() };
      cell.count++;
      const page = pageAt(c, m.start);
      if (!cell.seen.has(page)) {
        cell.seen.add(page);
        cell.pages.push(page);
      }
      byKind.set(m.kind, cell);
    }
  }

  const stems: PivStemFinding[] = [];
  let wrongCount = 0;
  let mixedCount = 0;

  for (const [stem, byKind] of acc) {
    const kinds = new Set(byKind.keys());
    const { verdict, reason } = classifyStem(stem, kinds);
    const forms: PivFormCount[] = [];
    for (const k of KIND_ORDER) {
      const cell = byKind.get(k);
      if (cell === undefined) continue;
      const sorted = [...cell.pages].sort(comparePageNames);
      forms.push({
        kind: k,
        count: cell.count,
        pages: sorted.slice(0, MAX_PAGES_LISTED),
        pageCount: sorted.length,
      });
    }
    /* «Exactly two» would be a mistake here: there are four spellings. The line
     * `rows.length === 2` in spelling2019.ts is correct because a PAIR of
     * forms always has two — it can't be copied here. */
    const mixed = forms.length > 1;
    if (verdict === "wrong") wrongCount++;
    if (mixed) mixedCount++;
    stems.push({ stem, verdict, reason, forms, mixed });
  }

  /* Composite key: a stem can be both wrong and mixed at the same time. */
  stems.sort((a, b) => {
    const byVerdict = Number(b.verdict === "wrong") - Number(a.verdict === "wrong");
    if (byVerdict !== 0) return byVerdict;
    const byMixed = Number(b.mixed) - Number(a.mixed);
    if (byMixed !== 0) return byMixed;
    return a.stem.localeCompare(b.stem, "uk");
  });

  return { stems, wrongCount, mixedCount, skippedByLanguage, excludedNotNumeral };
}

/**
 * Row ceiling. `typography_audit` has no response-budget mechanism (unlike
 * spelling_audit), so it's introduced here. The book measurement
 * (`docs/measured-facts-phase12.md`) found FOUR stems — the number 60 is NOT
 * that measurement, it's a margin the book doesn't come anywhere near: the
 * threshold is deliberately vacuous where the measurement gives too little
 * to derive a ceiling from, and a cutoff mechanism is still needed.
 */
export const MAX_PIV_STEMS = 60;

/**
 * Slices the stem inventory down to `MAX_PIV_STEMS` together with the hidden
 * count.
 *
 * LIVES HERE, NOT IN THE HANDLER, and the reason isn't tidiness. Until now
 * the slice sat as two lines inside `typography_audit`
 * (`src/tools/typography.ts`), i.e. out of reach of unit tests; the module
 * test admitted as much right in its name («there's enough material to
 * truncate — THE TRUNCATION ITSELF ISN'T TESTED»). The ceiling itself never
 * once fired — the book has four stems against 60 — meaning it had neither a
 * test nor a run behind it, resting on nothing but a code read. The same
 * step already taken for `auditcap.ts`: the ceiling logic moves into a leaf
 * module where it can be proven by execution.
 *
 * `hidden` is an actual count, not a flag: «60 shown» without it can't be
 * told apart from «there are exactly 60 of them».
 */
export function capPivStems<T>(stems: readonly T[], max: number = MAX_PIV_STEMS): {
  stems: T[];
  hidden: number;
} {
  return { stems: stems.slice(0, max), hidden: Math.max(0, stems.length - max) };
}

export const PIV2019_CAVEAT =
  "The verdict is issued ONLY where the orthography itself issued one (§ 36, item 6, " +
  "Note): a pre-reform apostrophe or hyphen after «пів», or a stem from one " +
  "of the two closed source lists, written against the list. Everything else is " +
  "inventory WITHOUT a verdict: for a stem the orthography didn't name, the tool doesn't " +
  "know the «correct» spelling at all, and the absence of a verdict does NOT mean " +
  "it's correct. Three stems (аркуша, острова, літра) are on both lists " +
  "at once — no verdict is possible for them either way, because both spellings " +
  "are correct in different meanings («мешканці півострова» and «пів острова»). " +
  "mixed only catches a stem coinciding IN THE SAME AND ONLY THE SAME case, so it " +
  "stays silent far more often than it speaks: in a book that writes «пів» separately " +
  "six times and together once, it gives ZERO, because the stems differ. A mixed of zero does NOT " +
  "mean the edition is consistent. The list of non-numerals (півень, півтори, " +
  "північ…) is closed and deliberately incomplete — a missing word gives an extra inventory row, " +
  "not a wrong verdict. The § 40 adjectives (півлітровий, півкілометровий) " +
  "aren't covered by this family: that's a different rule. Only ranges with the Ukrainian language are counted — " +
  "on a localized InDesign build the family will silently return zeros, so look " +
  "at ukrainianRuns. The pattern looks for «ів» in lowercase letters literally, so " +
  "text typed in ALL CAPS «ПІВ» isn't seen by the family; the All Caps attribute on " +
  "it makes no difference — a heading typed normally as «Пів»/«пів» with " +
  "capitalization via style is caught as usual. Only real " +
  "capital letters in the text itself are missed.";
