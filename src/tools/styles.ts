import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { detectCharacter } from "../styles/character.js";
import { MAX_CHAIN_STEPS, resolveChainsDetailed, detectHierarchy } from "../styles/hierarchy.js";
import { detectUsage } from "../styles/inventory.js";
import { buildReport } from "../styles/report.js";
import { detectRatioScale, detectScale, groupScales } from "../styles/scale.js";
import {
  UNUSED_STYLE_CAVEAT_TEXT,
  type StyleFinding,
  type StylesMeasure,
} from "../styles/types.js";
import { fail, ok, type Tools } from "./shared.js";

/**
 * Style-measurement timeout.
 *
 * The number is NOT carried over from `layout_measure` (600 s) and NOT derived from the
 * 267 ms direct probe: 267 ms is a measurement of the PROBE, not of the finished handler, and the
 * spec explicitly forbids promising someone else's number (§10). 120 s is a ceiling, deliberately
 * set with a wide margin over the expected value.
 *
 * THE REAL NUMBER IS MEASURED (Task 10, `docs/measured-facts-phase5.md`,
 * the “Running the finished tool” section): a full `styles_measure` run on the user's
 * working book (198 pages) — **10,860 ms**, ≈9% of the ceiling. Far under
 * half of 120,000, so the constant stays unchanged; an earlier version of
 * this comment claimed the measurement was impossible (“Task 10 not
 * done, the book is closed”) — Task 10 was done, the book was open.
 * The ceiling remains a ceiling with margin, not a measured time; if someday
 * a run on an even bigger document approaches it, that is itself a
 * finding, not a reason to silently raise the constant.
 *
 * AND THAT DID HAPPEN — 2026-08-17, «02 Зоряні Мрії», 592 pages:
 * the run HIT 120,000 and didn't finish. The ceiling was temporarily raised
 * to 900,000 SPECIFICALLY TO MEASURE, and the measurement gave **220,228 ms**. So
 * growth is NOT linear: 198 pages → 10,860 ms, 592 pages → 220,228 ms, i.e.
 * three times as many pages gave twenty times more time. The cause hasn't been
 * investigated — that's an open question, not an explained number.
 *
 * The new ceiling of 600,000 is 2.7× over the measured value, and it's aligned with
 * layout_measure, the most expensive neighbor. The number was chosen from the MEASUREMENT, not
 * arbitrarily; the next document that approaches it will again be a
 * finding.
 */
export const STYLES_MEASURE_TIMEOUT_MS = 600_000;

/**
 * FIVE families, not three (correction per Tasks 12–14). `character` and
 * `hierarchy` exist because probe H5 found material: hundreds of ranges
 * deviating from the paragraph baseline, and 23 styles out of 51 nested deeper
 * than one level of the `basedOn` chain.
 *
 * THE REAL NUMBER IS MEASURED (Task 10): `detectCharacter` on the working book
 * (198 pages) gave `rangesDeviating = 744` out of `rangesAudited = 3480`.
 * This is NOT the same number as probe H5's 449 (`docs/measured-facts-phase5.md`,
 * Question 2) — 449 was measured on a DIFFERENT, narrower population (3137 bare
 * ranges, `characterStyle === "[None]"`), whereas `detectCharacter`
 * walks all 3480 audited ranges regardless of character style and
 * excludes parents. Two different detectors on two different populations —
 * substituting one number for the other is not allowed. Details of both measurements are in
 * `docs/measured-facts-phase5.md`, Question 2 (probe) and the “Running the
 * finished tool” section (Task 10, the finished detector).
 */
const FAMILIES = ["usage", "overrides", "scale", "character", "hierarchy"] as const;

const DETAIL_GROUPS = ["indents", "sizes", "justification", "font", "lists", "tracking"] as const;

/**
 * The families for which `detail` makes sense at all — the same four whose
 * per-paragraph/per-range findings do NOT go into the default response
 * (round 1 review, Important 5). `hierarchy` isn't here: both of its findings
 * (`styles-indistinguishable`, `based-on-missing`) are already few and already in
 * `findings` — they don't need separate addressing.
 */
const DETAIL_FAMILIES = ["overrides", "scale", "character", "usage"] as const;

/**
 * The unit of a single `detail` entry is per family (round 3 review, Important 2).
 *
 * `character` is CALLED OUT SEPARATELY and at greatest length: `characterRangesDeviating` in
 * the summary counts DISTINCT RANGES (deduplicated on three fields — see
 * `CharacterResult.rangesDeviating`, `src/styles/character.ts`), while
 * `detail` for this family reads `character.findings` DIRECTLY — pairs of
 * (range, property), deliberately more granular than the summary: a range
 * deviating in two properties must show BOTH in the addressed
 * listing, otherwise the operator won't learn exactly what's wrong there.
 *
 * THE COMPARISON OF `detailTruncated.total` WITH THE SUMMARY HAS BEEN REMOVED ENTIRELY (I-2
 * of the final review). An earlier version promised that `total` for
 * `character` would be LARGER than the summary, with the example "864 vs 449" — and that's
 * wrong twice over. First, the domains are different: `detailFull`
 * is filtered by `detail.styleId`, so `total` is always about ONE style,
 * while the summary is about the whole document, so `total` can be anything, and
 * is most often SMALLER. Second, 864 is the sum of probe H5's `byProperty`, i.e.
 * yet another population (bare ranges). The rule is simple and true:
 * `total` is the count of entries FOR THE REQUESTED STYLE in that
 * family's units; the summary is for the whole document; they cannot be compared at all.
 */
const DETAIL_UNIT: Record<(typeof DETAIL_FAMILIES)[number], string> = {
  overrides: "pair (paragraph, property)",
  scale: "paragraph",
  character:
    "pair (range, property) — a different unit from characterRangesDeviating in the summary " +
    "(there the ranges are DISTINCT): one range with several deviating properties yields " +
    "several entries here",
  usage: "paragraph",
};

/**
 * Explanation of the `detailTruncated.total` field, which travels IN THE RESPONSE ITSELF.
 *
 * The unit (`detailUnit`) says WHAT is counted; this one says FOR WHOM. Both are needed
 * right here, not only in the tool description: without the second line the operator
 * naturally divides `total` by a number from the summary, and those are numbers from different
 * domains (one style versus the whole document).
 */
const DETAIL_TOTAL_NOTE =
  "detailTruncated.total — the number of entries FOR THE REQUESTED STYLE in this family's units " +
  "(detailUnit). The whole-document block numbers (characterRangesDeviating, scaleParagraphs, " +
  "overridePropertyDeviations) count a DIFFERENT domain — the whole document — so " +
  "they must not be compared with total.";

/**
 * A ceiling on `detail`, not just on the default response (CRITICAL, round
 * 2 review). `detail` is exactly the call the operator will make upon seeing a total
 * in the hundreds of ranges: without a ceiling here we'd be carrying the 78 KB trap (Phase 4)
 * straight to the place we ourselves are pointing to. The number isn't invented
 * from scratch — it's the same order of magnitude already established in the project for "a listing for
 * one narrow request" (`MAX_CANDIDATES_PER_REQUEST = 50`,
 * `src/corrections/planner.ts`). 50 findings ≈ 350–400 B each (measured
 * via serialization) — that's ≈18 KB, with a wide margin under 78 KB.
 *
 * APPLIED AFTER THE `switch` DELIBERATELY, ONE LINE FOR ALL FAMILIES
 * (round 3 review, mutant M3): a ceiling scattered across `switch` branches
 * would rely on EVERY branch remembering it — forget just
 * one, and exactly that family is left unbounded. A single
 * `.slice()` after the switch has no branch that can be forgotten.
 */
const MAX_DETAIL_ITEMS = 50;

/** The "container + paragraph index" pair key — the same one already used in `character.ts`. */
function paragraphKey(containerId: string, paragraphIndex: number): string {
  return `${containerId}#${paragraphIndex}`;
}

export function registerStyleTools(server: Tools): void {
  server.registerTool(
    "styles_audit",
    {
      title: "Paragraph style hygiene",
      description:
        "A row for EVERY paragraph style in the document. Two different usage numbers, and they must not be " +
          "confused: `paragraphs` — how many paragraphs apply the style IN TOTAL, including " +
          "parent spreads (this answers “is the style used at all”); `paragraphsAudited` — " +
          "how many of those ACTUALLY went through the override check (parents are excluded by " +
          "construction — a running head departs from its paragraph style by design). The " +
          "`ratio` share is `deviating / paragraphsAudited`, NOT `/ paragraphs`: 21 of 21 means that " +
          "it is the style that needs fixing, not the paragraphs. `ratio: null` — and that is THREE DIFFERENT states, not one: " +
          "(1) the style is used by nobody; (2) the style is used only on parents — `paragraphs` is " +
          "non-zero, `paragraphsAudited` zero; (3) the `overrides` family is switched off — `paragraphsAudited` is " +
          "zero for EVERY row, and that is visible from `totals.overridePropertyDeviations === null` rather than from " +
          "the 0 itself. `totals.paragraphs` is a THIRD number on the same axis, and it is NOT the denominator " +
          "of anything: it counts every paragraph of the measurement, including parent spreads and " +
          "the pasteboard (`totals.paragraphsOffPage` names the second part separately), whereas " +
          "the neighbouring numbers (`usageDefaultStyleApplied`, `ratioMatches`, `characterRangesDeviating`) " +
          "do not count parents. One must not be divided by the other. " +
          "A separate `findings` listing carries the findings that have an address, few in number by " +
          "construction (bounded by the number of STYLES, not of paragraphs or ranges): unused paragraph and " +
          "character styles, styles indistinguishable by the measured property set, and basedOn " +
          "references pointing nowhere. " +
          "“ZERO PARAGRAPHS” AND “REDUNDANT” ARE DIFFERENT STATEMENTS, AND THE REPORT TELLS THEM APART. An unused style " +
          "yields one of TWO defects: `style-unused-leaf` — it has neither paragraphs nor " +
          "other styles on it and can be deleted; `style-unused-base` — zero paragraphs, but it is an abstract " +
          "parent that other styles rest on, and the finding's text names exactly how many " +
          "styles and paragraphs sit beneath them. A base MUST NOT be deleted: `style.remove()` reattaches the children " +
          "to the GRANDPARENT, and the deleted style's own overrides are lost, so the children silently " +
          "inherit different values — measured on the book on 2026-08-16, where deleting one " +
          "such base sent 387 paragraphs into justification. First move the values into the " +
          "descendants, and only then delete. `totals.usageUnusedStyles` is the sum of both; the action " +
          "is permitted only by `totals.usageUnusedLeafStyles`. The cleanup is ITERATIVE: a style all of whose " +
          "children are leaves becomes a leaf itself (the dead Word Normal→heading 3/4 branch " +
          "comes off whole). A basedOn cycle is never declared a leaf. " +
          "A `style-unused-leaf` FINDING IS NOT PERMISSION TO DELETE THE STYLE: the measurement goes over story.paragraphs and " +
          "SEES NEITHER TABLE cells NOR FOOTNOTES. A paragraph style (like a character style) used " +
          "only in a table or a footnote looks unused here although it is in fact alive — before " +
          "deleting, check tables and footnotes by hand. The same limit understates " +
          "`characterRangesDeviating` and every number of the `character` family. The text of each such finding " +
          "carries the prohibition itself (“do not delete without checking tables and footnotes”), while the full " +
          "explanation of the mechanism sits in the response ONCE, in the `caveats.tablesAndFootnotes` field: " +
          "repeating it in every finding would inflate the response for every unused " +
          "style — measured at 389 B per finding, i.e. ≈39 KB on a document with 100 such styles. " +
          "THE SECOND KNOWN LIMIT IS A LOCALISED InDesign: the built-in styles ([Basic Paragraph], " +
          "[No Paragraph Style]) and the [None] sentinel are matched by their ENGLISH names, so on " +
          "a localised build the usage family will quietly return zeros (not “zero measured” but “nothing " +
          "recognised”), and unused character styles will be counted together with [None]. Not measured: " +
          "the working book was run on an English build. " +
          "A CHARACTER STYLE MAY BE APPLIED OUTSIDE THE TEXT: by a list bullet, by numbering, " +
          "by a nested or GREP style, by a cross-reference block, by a page number in a contents " +
          "style. Such styles have zero text ranges and do NOT produce a `character-style-unused` " +
          "finding — they are listed separately, in `character.stylesOnlyReferenced`, with the name of the carrier " +
          "on each, and `character.unusedStyles` is reduced by the same amount. `character." +
          "carrierProbeFailures` — how many reads failed during that search: zero means " +
          "“we walked everything we know how to”, more than zero means that on this document non-usage may be " +
          "reported wrongly. " +
          "THE `character` FAMILY IS AN INVENTORY OF LOCAL CHARACTER FORMATTING, NOT A LIST OF " +
          "DEFECTS: changing size, typeface and tracking is the direct purpose of a character style, not " +
          "a typesetter's mistake. The `usage` (paragraphs directly on a built-in style), `scale` " +
          "(scaled text) and `character` (character deviations) families give only a SUM in `totals`, " +
          "as a named count of paragraphs/ranges — not a list of addresses: character deviations on " +
          "a real book (198 pages, Task 10, docs/measured-facts-phase5.md) number 744 distinct " +
          "ranges (rangesDeviating out of rangesAudited 3480; NOT the same number as the 449 from the same " +
          "document, Question 2 — 449 was measured by probe H5 on a NARROWER population, only among bare " +
          "ranges), and a listing of that size would make " +
          "the response unusable (Phase 4 already stumbled on 78 KB for three pages). Each of " +
          "these numbers has its own unit of measure, named in the `totals` field name itself (styles/" +
          "paragraphs/pairs/ranges), and numbers of DIFFERENT families are NEVER summed into a single " +
          "“total”: `character` " +
          "and `scale` describe the same places from different sides (ranges against paragraphs), " +
          "`overridePropertyDeviations` counts PAIRS (paragraph, property) — a paragraph deviating in " +
          "leftIndent and rightIndent (both in the indents group) yields 2 here, not 1 — and " +
          "`hierarchyStylesInChains` is not a number of findings but a number of STYLES deeper than one " +
          "basedOn level. " +
          "`character` OVERLAPS `overrides` TOO, not only `scale`: `overrides` suppresses the " +
          "sizes/font/tracking groups ONLY for a paragraph with an APPLIED character style, whereas for " +
          "a paragraph with BARE ranges those groups are compared — and `character` issues its own finding for the same " +
          "range. That is, one place can produce an entry in BOTH families; they must not be added together " +
          "any more than `character` and `scale`. " +
          "THE `character` BLOCK HAS ITS OWN DENOMINATOR: `rangesAudited` — the ranges that actually " +
          "entered the check (parents excluded), and that is what `rangesDeviating` must be divided " +
          "by. `rangesTotal` is every range of the measurement, parents included; a share " +
          "taken from it is systematically understated. " +
          "THE `scale` FAMILY IS MEASURED BY TWO INDEPENDENT DETECTORS ON PURPOSE: `paragraphs` — from " +
          "a direct read of the frame's scale (all paragraphs, parents included — `ScaleMeasure` carries no " +
          "parent flag); `ratioMatches`/`ratioUnavailable` — from a SECOND, weaker detector " +
          "(the ratio of point size to leading, parents excluded), which remains precisely because " +
          "a trap in the primary detector once spoiled the conclusion and the second one did not catch it. " +
          "The divergence between `paragraphs` and `ratioMatches` has TWO causes at once, not one: the weaker " +
          "method structurally misses some cases (documented in `scale.ts`), and the populations of paragraphs differ " +
          "(with parents against without) — so the divergence is a SIGNAL rather than an error, " +
          "but part of that signal is now mechanical, not only methodological. " +
          "A by-name listing for any of the four per-paragraph/per-range families " +
          "(`overrides`, `scale`, `character`, `usage`) — only through `detail: { family, styleId, " +
          "group? }`, by the style's `.id`, NOT by name (two different styles may be called the same). `group` " +
          "is mandatory only for `family: \"overrides\"`. `family` MUST be among the requested " +
          "`families` — otherwise the tool refuses to answer with an explanation rather than quietly " +
          "returning an empty listing (an empty listing and “the family was not counted” are different states). Without " +
          "`detail` no listing is issued at all. The listing is truncated to " +
          `${MAX_DETAIL_ITEMS} entries; when truncated, \`detailTruncated: { shown, ` +
          "total }` appears — a silent truncation would read as “this is everything there is”. Each `detail` entry has " +
          "ITS OWN unit per family (the `detailUnit` field in the response): for `character` it is a pair " +
          "(range, property), NOT the same range as in `characterRangesDeviating`. " +
          "`detailTruncated.total` is the number of entries FOR THE REQUESTED STYLE; the block numbers " +
          "count the whole document, so total must not be compared with the summary in either direction " +
          "(the `detailTotalNote` field in the response says so where the operator reads the numbers themselves). " +
          "THE SAME RULES APPLY TO THE DEFAULT RESPONSE: `styles[].groups[].values` (which values " +
          "occur) and `scale.groups` (scale values) also have a ceiling, because there is no pages " +
          "parameter and both structures grow with the document; the truncation is named through " +
          "`valuesTruncated`, `groupsTruncated`, `containersTruncated`, `stylesTruncated`. " +
          "THE `usage` FAMILY HAS ITS OWN LIMIT, NAMED HONESTLY: `styleId` here addresses the built-in " +
          "style itself ([Basic Paragraph] or [No Paragraph Style]) — there are only two of them, so unlike " +
          "the other families (where hundreds of ranges are scattered across dozens of styleIds and the ceiling rarely gets in the way) " +
          "addressing here does NOT split the listing: a document with thousands of paragraphs on one built-in " +
          "style will always show only the first 50, and the rest is unreachable through this tool at all. " +
          "Narrow the search for other places through document_map or text_find. " +
          "The tool writes nothing to the document and proposes no corrections. There is deliberately no page-range " +
          "parameter: style hygiene is a property of the document rather than of a range — " +
          "a style unused on pages 10-20 may well be used on page 150.",
      inputSchema: {
        families: z
          .array(z.enum(FAMILIES))
          .default([...FAMILIES])
          .describe("Which families to count."),
        detail: z
          .object({
            family: z
              .enum(DETAIL_FAMILIES)
              .describe(
                "Whose addressing: overrides — paragraphs that override (style, group); " +
                  "scale — paragraphs with scale ≠ 100; character — ranges with a local " +
                  "character deviation (range+property pairs — a different unit from " +
                  "characterRangesDeviating in the summary); usage — paragraphs directly on a built-in " +
                  "style (NOTE: there are only two built-in styles, so styleId here does NOT split the listing " +
                  "the way it does for the other families — on a document with thousands of such paragraphs everything after " +
                  "the first 50 is unreachable; narrow the search through document_map/text_find).",
              ),
            styleId: z
              .string()
              .describe(
                "The style's `.id`, by which ONE (family, styleId[, group]) pair is addressed. NOT the name: " +
                  "two different styles may be called the same (measured by probe H5), and a filter by " +
                  "name would return the findings of BOTH, mixing a used style with an unused one. For " +
                  "`family: \"usage\"` this is the `.id` OF THE BUILT-IN STYLE ITSELF (`[Basic Paragraph]` or " +
                  "`[No Paragraph Style]`), not of a paragraph style the paragraph does not have.",
              ),
            group: z
              .enum(DETAIL_GROUPS)
              .optional()
              .describe("Mandatory only for `family: \"overrides\"`; ignored for the other families."),
          })
          .refine((d) => d.family !== "overrides" || d.group !== undefined, {
            message: 'family "overrides" requires group.',
            path: ["group"],
          })
          .optional()
          .describe(
            "A by-name listing for ONE (family, styleId[, group]) pair, no more than " +
              `${MAX_DETAIL_ITEMS} entries (beyond that — \`detailTruncated\`). Without this field no listing is ` +
              "issued at all.",
          ),
      },
    },
    async ({ families, detail }) => {
      try {
        /*
         * Minor item 4 of round 2 / item 3 of round 3: `detail.family`, when not requested in
         * `families`, used to silently give `[]` — indistinguishable from "no
         * matches". Now it's an explicit refusal BEFORE any call to the
         * bridge. The check is INSIDE the `try` (moved, round 3 review,
         * minor item 3): if this condition ever throws on its own (say
         * `families` turns out not to be an array due to broken validation),
         * the `catch` below will still return a text `fail()` response, not
         * a protocol exception.
         */
        if (detail !== undefined && !families.includes(detail.family)) {
          return fail(
            new Error(
              `detail.family "${detail.family}" is not among families [${families.join(", ")}]. ` +
                "Without that family among families, no data is counted for it at all — add " +
                "the family to families or drop detail.",
            ),
          );
        }

        const measure = await runJsx<StylesMeasure>("styles_measure", {}, {
          timeoutMs: STYLES_MEASURE_TIMEOUT_MS,
        });

        /*
         * `withOverrides` controls EXACTLY the overrides detector. Paragraphs and
         * the inventory in `buildReport` always go through in full: usage is a fact
         * of the document, not a consequence of the overrides detector's work. Computing
         * it from an empty list would make every style show as
         * unused the moment the operator excludes the overrides family.
         */
        const report = buildReport(measure, { withOverrides: families.includes("overrides") });

        /*
         * `isMasterByKey` — the same `containerId#paragraphIndex` that already
         * keys `character.ts`. Needed for two filters below:
         * `default-style-applied` (`usage`) and `detectRatioScale` — both
         * walk the FULL paragraph list, whereas the neighboring fix
         * `paragraphsAudited` already set the project policy —
         * parents are structurally out of scope for the check. `character.ts` now
         * filters `isMaster` itself, from its own `ParagraphMeasure` —
         * it doesn't need this same key.
         */
        const isMasterByKey = new Map<string, boolean>();
        for (const p of measure.paragraphs) isMasterByKey.set(paragraphKey(p.containerId, p.paragraphIndex), p.isMaster);

        /*
         * `detectUsage` — ONE call for the whole handler (minor item 3,
         * round 2 review): it used to be called twice on the same data —
         * exactly the duplication that `report.ts` deliberately guards
         * `detectOverrides` against ("two calls could diverge").
         */
        const usageFindings = families.includes("usage")
          ? detectUsage(measure.styles, measure.paragraphs)
          : [];

        /*
         * `findings` — ONLY findings whose count is, by construction, bounded by
         * the number of DECLARED STYLES (dozens), not paragraphs or ranges
         * (thousands): unused styles, indistinguishable pairs, broken
         * basedOn, unused character styles. An ALLOWLIST everywhere, not
         * a denylist: every push filters on a specific `.defect`, so
         * a new per-paragraph defect added tomorrow to any of these
         * detectors will NOT end up in the response on its own.
         *
         * CRITICAL (round 1 review): `default-style-applied` does NOT
         * GO HERE. `detectUsage`'s second loop (`src/styles/inventory.ts`) produces
         * a finding for EVERY paragraph on a helper style — there IS a
         * bound by construction, but it's a count of PARAGRAPHS, not styles: on a book
         * imported from Word and sitting entirely on `[Basic Paragraph]`,
         * that's thousands of entries — exactly the 78 KB Phase 4 already
         * tripped over once. So this finding is treated the same way as
         * `character-override`/`scaled-text` — a total in the `usage` block
         * below, addresses only via `detail`.
         */
        const findings: StyleFinding[] = [];
        for (const f of usageFindings) {
          if (f.defect === "style-unused-leaf" || f.defect === "style-unused-base") findings.push(f);
        }
        /*
         * Minor item 6 (round 2 review): the same allowlist for
         * `hierarchy` too, even though `detectHierarchy` currently gives
         * only these two `.defect` values — the construction should stay uniform,
         * not the one exception done with a spread.
         */
        if (families.includes("hierarchy")) {
          for (const f of detectHierarchy(measure.styles)) {
            if (f.defect === "styles-indistinguishable" || f.defect === "based-on-missing") findings.push(f);
          }
        }

        const character = families.includes("character") ? detectCharacter(measure) : null;
        if (character) {
          for (const f of character.findings) {
            if (f.defect === "character-style-unused") findings.push(f);
          }
        }

        /*
         * `usageDefaultApplied` — the same per-paragraph class as
         * `character-override`/`scaled-text`: NOT in `findings`, only a total
         * (`usageBlock.defaultStyleApplied`) and addresses via
         * `detail: { family: "usage", styleId }`. Parent paragraphs are
         * filtered out (minor item 2 of round 1) — the same
         * `paragraphsAudited` policy, not a new one.
         */
        const usageDefaultApplied = usageFindings.filter(
          (f) =>
            f.defect === "default-style-applied" &&
            !(isMasterByKey.get(paragraphKey(f.containerId ?? "", f.paragraphIndex ?? -1)) ?? false),
        );
        const usageBlock = families.includes("usage")
          ? {
              /*
               * THREE NUMBERS, AND THE MIDDLE ONE IS THE ONLY ONE SAFE TO ACT ON.
               * `unusedStyles` stays a total (how many styles have no
               * paragraph at all), so the same name doesn't start meaning less than
               * it used to. Only `unusedLeafStyles` licenses an action;
               * `unusedBaseStyles` is a caution, not a task.
               */
              unusedStyles: findings.filter(
                (f) =>
                  f.family === "usage" &&
                  (f.defect === "style-unused-leaf" || f.defect === "style-unused-base"),
              ).length,
              unusedLeafStyles: findings.filter(
                (f) => f.family === "usage" && f.defect === "style-unused-leaf",
              ).length,
              unusedBaseStyles: findings.filter(
                (f) => f.family === "usage" && f.defect === "style-unused-base",
              ).length,
              defaultStyleApplied: usageDefaultApplied.length,
            }
          : null;

        /*
         * `scale` does NOT carry raw addresses by default (Important 4, round
         * 1): addresses go via `detail`, from the PRIMARY detector
         * (`detectScale`, which has `styleId`), not from the confirming one
         * (`RatioMatch` carries no styleId — there's nothing to address with it).
         *
         * `detectRatioScale` filters `isMaster` — the same policy as
         * `usageDefaultApplied`. `measure.scales` (where `scale.paragraphs` comes from)
         * CANNOT be filtered the same way: `ScaleMeasure` doesn't carry
         * `isMaster` (a structural limit, named in the tool description, not
         * silently left out) — so this asymmetry remains the one of the four that
         * can't be closed without changing the measurement (`styles.jsx`), not through
         * a code convenience here.
         */
        const scaleParagraphs = families.includes("scale") ? detectScale(measure.scales) : [];
        const scaleBlock = families.includes("scale")
          ? (() => {
              const auditedParagraphs = measure.paragraphs.filter((p) => !p.isMaster);
              const ratio = detectRatioScale(auditedParagraphs);
              /*
               * I-6 (final review): `groupScales` now carries its own ceiling
               * and names the truncation. The group key deliberately holds the EXACT
               * float value — the construction maximizes the number of groups, and
               * the tool has no page parameter, so without a ceiling this
               * structure would grow with the document without any bound.
               */
              const grouping = groupScales(measure.scales);
              return {
                groups: grouping.groups,
                ...(grouping.groupsTruncated ? { groupsTruncated: grouping.groupsTruncated } : {}),
                paragraphs: scaleParagraphs.length,
                ratioMatches: ratio.matches.length,
                ratioUnavailable: ratio.noRatio,
              };
            })()
          : null;

        const characterBlock = (() => {
          if (!character) return null;
          const declared = measure.characterStyles.filter((cs) => cs.name !== "[None]");
          const used = declared.filter((cs) => cs.appliedRuns > 0);
          /*
           * `unusedStyles` — NOT a simple "declared minus in the text" difference.
           * A style that serves as a list marker, numbering, a nested or
           * GREP style, a cross-reference block, or a TOC page
           * number has zero text ranges and is nonetheless
           * APPLIED. It no longer produces a `character-style-unused`
           * finding (`src/styles/character.ts`) — and if this number stayed a
           * simple difference, it would diverge from the findings list in that same
           * response. That kind of gap already cost a phase a Critical in a neighboring
           * family.
           */
          const onlyReferenced = character.stylesOnlyReferenced;
          return {
            declaredStyles: declared.length,
            usedStyles: used.length,
            unusedStyles: declared.length - used.length - onlyReferenced.length,
            /* An inventory, not a verdict: styles that live only on a carrier outside
             * the text, with the carrier's name attached to each. */
            stylesOnlyReferenced: onlyReferenced,
            /*
             * How many reads failed while searching for carriers. Zero means
             * "we covered everything we know how to"; nonzero means that on this
             * document `character-style-unused` may FALSELY call a style
             * unused, and the operator must see that, not trust the
             * silence.
             */
            carrierProbeFailures: measure.characterStyleCarrierFailures ?? 0,
            /*
             * THREE NUMBERS, THREE DIFFERENT POPULATIONS, AND ONLY TWO OF THEM DIVIDE
             * INTO ONE ANOTHER (I-3 of the final review).
             *
             * `rangesTotal` — every range of the measurement, including those
             * on parent spreads and those whose paragraph wasn't
             * found in the measurement; `rangesAudited` — exactly the ones that made it
             * to the comparison; `rangesDeviating` — a subset of
             * `rangesAudited`. The block used to give only the first and third —
             * that is, it invited dividing one population's numerator by
             * another population's denominator and getting an UNDERSTATED share. This is literally the
             * defect that Task 6 closed with the `paragraphsAudited` field;
             * here it was opened a third time.
             */
            rangesTotal: measure.ranges.length,
            rangesAudited: character.rangesAudited,
            /*
             * Important 1 (round 3 review): a SINGLE source of truth —
             * `detectCharacter` counts this in the same loop that builds
             * `findings`/`byProperty`, and returns it ready-made as the
             * `rangesDeviating` field. The tool used to duplicate the comparison
             * locally (`distinctDeviatingRanges`), and the duplicate had already
             * managed to mask an undercount: a test that removed `tracking`/
             * `horizontalScale` from the local copy of the property list
             * would have passed unnoticed — the guard "sum of byProperty ≥
             * rangesDeviating" only catches an OVERCOUNT, never an UNDERCOUNT.
             */
            rangesDeviating: character.rangesDeviating,
            byProperty: character.byProperty,
          };
        })();

        const hierarchyBlock = (() => {
          if (!families.includes("hierarchy")) return null;
          const { chains, truncated } = resolveChainsDetailed(measure.styles);
          const depths = [...chains.values()].map((c) => c.length - 1);
          return {
            /* Deeper than one level — 23 out of 51 on the working book (probe H5). NOT
             * a count of findings: `styles-indistinguishable`/`based-on-missing`
             * (the family's actual findings) are already in `findings`; this is a different axis. */
            stylesInChains: depths.filter((d) => d > 0).length,
            maxChainDepth: depths.length > 0 ? Math.max(...depths) : 0,
            /*
             * Minor item 3 (final review): the ceiling on steps along
             * `basedOnId` used to trigger SILENTLY — both a document with a chain of
             * 50 levels and one with a chain of 500 showed the same
             * `maxChainDepth: 50`. The same principle as for `detail`:
             * truncation is named. The field is conditional — it appears only
             * when the ceiling actually triggered.
             *
             * `stylesAffected`, NOT `styles` (wave review, minor
             * item 1): in THIS SAME response `scale.groups[].styles` is an array
             * of objects, and the same name for a NUMBER and for an ARRAY would be yet
             * another unit named with the wrong name, in a phase that has already
             * paid for that twice.
             */
            ...(truncated.length > 0
              ? { chainDepthTruncated: { limit: MAX_CHAIN_STEPS, stylesAffected: truncated.length } }
              : {}),
          };
        })();

        /*
         * A by-name listing for ONE (family, styleId[, group]) pair —
         * Important 5 of round 1. `detail.family` here is GUARANTEED to be among
         * `families` (checked on input), so the switch has no
         * "unreachable" branch.
         */
        const detailFull = (() => {
          if (detail === undefined) return null;
          switch (detail.family) {
            case "overrides":
              return report.overrideFindings.filter(
                (f) => f.styleId === detail.styleId && f.group === detail.group,
              );
            case "scale":
              return scaleParagraphs.filter((f) => f.styleId === detail.styleId);
            case "character":
              return character
                ? character.findings.filter((f) => f.defect === "character-override" && f.styleId === detail.styleId)
                : [];
            case "usage":
              return usageDefaultApplied.filter((f) => f.styleId === detail.styleId);
          }
        })();

        /*
         * CRITICAL (round 2 review): a ceiling on the RAW `detail` listing, not
         * just on the default response. `ok()` serializes via `JSON.stringify(
         * data, null, 2)` — ≈350–400 B per finding; without a ceiling `detail` for
         * `character` on the working book is ≈300 KB, and for `usage` on
         * a manuscript from Word (thousands of paragraphs on a helper style) it's under
         * a megabyte. The truncation is NAMED, not silent: `detailTruncated`
         * appears only when it was actually truncated (the same conditional shape
         * as `candidatesTruncated` in `src/corrections/planner.ts`). A single
         * `.slice()` AFTER the `switch`, not in any individual branch (mutant M3,
         * round 3 review) — see the `MAX_DETAIL_ITEMS` docstring.
         */
        /*
         * THE CAVEAT ABOUT TABLES AND FOOTNOTES — ONCE PER RESPONSE
         * (final-wave review, item 2).
         *
         * The first version of the I-4 fix wrote the full text into EVERY
         * `style-unused`/`character-style-unused` finding. Measured on the fixture:
         * 5 findings × 389 B = 1,785 B, i.e. 85% of the whole response
         * growth (2,103 B) was the same sentence repeated. On a book
         * with 14 unused styles that's ≈5.5 KB, on 100 it's ≈39 KB: exactly the
         * per-paragraph bloat the rest of the phase was written against.
         *
         * The review's condition — "the operator must see the caveat WHERE THEY
         * READ THE ADVICE" — is not violated: the finding itself still carries the PROHIBITION
         * with the places to check ("don't delete without checking tables
         * and footnotes"); only the explanation of the REASON has been moved out here. The field is
         * conditional — it appears exactly when `findings` has at least one
         * finding referencing it, and costs 0 B when there are no such
         * findings.
         */
        const hasUnusedStyleFinding = findings.some(
          (f) =>
            f.defect === "style-unused-leaf" ||
            f.defect === "style-unused-base" ||
            f.defect === "character-style-unused",
        );

        const detail_ = detailFull === null ? null : detailFull.slice(0, MAX_DETAIL_ITEMS);
        const detailTruncated =
          detailFull !== null && detailFull.length > MAX_DETAIL_ITEMS
            ? { shown: MAX_DETAIL_ITEMS, total: detailFull.length }
            : undefined;

        return ok({
          docName: measure.docName,
          families,
          styles: report.rows,
          findings,
          ...(hasUnusedStyleFinding ? { caveats: { tablesAndFootnotes: UNUSED_STYLE_CAVEAT_TEXT } } : {}),
          usage: usageBlock,
          scale: scaleBlock,
          character: characterBlock,
          hierarchy: hierarchyBlock,
          detail: detail_,
          /*
           * Important 2 (round 3 review): the `detail` unit is named IN
           * THE RESPONSE ITSELF, not only in the tool description — the operator sees
           * it right next to the numbers, instead of having to go read the
           * documentation to understand why `detailTruncated.total` for `character`
           * doesn't match `characterRangesDeviating`.
           */
          ...(detail !== undefined
            ? { detailUnit: DETAIL_UNIT[detail.family], detailTotalNote: DETAIL_TOTAL_NOTE }
            : {}),
          ...(detailTruncated ? { detailTruncated } : {}),
          /*
           * TOTALS — PER FAMILY SEPARATELY, WITH NO COMBINED SUM (correction §3).
           * Each field carries its unit of measure in its own NAME (styles vs.
           * paragraphs vs. pairs vs. ranges) — which is exactly why they cannot
           * be added into one "total findings": `null` means "the family was not
           * counted", not "it was counted and came out zero".
           */
          totals: {
            declaredStyles: measure.styles.length,
            usedStyles: report.rows.filter((r) => r.paragraphs > 0).length,
            /*
             * NOT A DENOMINATOR (final review, minor item 2). This is the FULL
             * list of paragraphs in the measurement — including parent spreads and
             * the pasteboard — whereas all the neighboring numbers
             * (`usageDefaultStyleApplied`, `characterRangesDeviating`,
             * `ratioMatches`) don't count parents. There's deliberately NO analog of
             * `paragraphsAudited` here: "audited"
             * means something different for every family (overrides — not parents, scale —
             * all, character — not parents with a matched paragraph), so
             * one shared number would be a fourth population, not a
             * denominator. The prohibition on dividing is stated in the tool description.
             */
            paragraphs: measure.paragraphs.length,
            paragraphsOffPage: measure.paragraphsOffPage,
            usageUnusedStyles: usageBlock ? usageBlock.unusedStyles : null,
            usageUnusedLeafStyles: usageBlock ? usageBlock.unusedLeafStyles : null,
            usageUnusedBaseStyles: usageBlock ? usageBlock.unusedBaseStyles : null,
            usageDefaultStyleApplied: usageBlock ? usageBlock.defaultStyleApplied : null,
            /*
             * Important 2 (round 2): PAIRS of (paragraph, PROPERTY), not (paragraph,
             * group). `src/layout/overrides.ts` pushes a finding in a loop
             * OVER PROPERTIES (`GROUP_PROPERTIES` flatMap) — a paragraph that
             * deviates in both leftIndent and rightIndent (both in the
             * `indents` group) yields 2 here, not 1. The old name
             * `overridePairs` and the comment "(paragraph, group)" were themselves
             * the defect the Important 3 fix of round 1 was written against:
             * naming a unit wrong is the same as not naming it.
             */
            overridePropertyDeviations: families.includes("overrides") ? report.overrideFindings.length : null,
            scaleParagraphs: scaleBlock ? scaleBlock.paragraphs : null,
            characterRangesDeviating: characterBlock ? characterBlock.rangesDeviating : null,
            /* Styles, not findings — see the comment at hierarchyBlock. */
            hierarchyStylesInChains: hierarchyBlock ? hierarchyBlock.stylesInChains : null,
          },
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
