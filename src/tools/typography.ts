import { z } from "zod";
import { runWrite } from "../bridge/envelope.js";
import { runJsx } from "../bridge/runner.js";
import { orderForApply } from "../corrections/planner.js";
import type {
  AcceptedEdit,
  ApplyReport,
  ContainerSnapshot,
} from "../corrections/types.js";
import type { ContainerLanguage, LanguageRun } from "../spelling/types.js";
import { assertLanguageCoverage, readLanguageRuns } from "../spelling/langruns.js";
import { groupByRule, runRules, type RuleMatch, type TypographyRule } from "../typography/engine.js";
import { countLanguageRuns, fullyInLanguage, mergedRuns, UK_LANGUAGE } from "../typography/langgate.js";
import { auditOnly } from "../typography/rules-uk.js";
import type { Locale } from "../typography/locale.js";
import {
  allRuleIds,
  crossLocaleApplies,
  inForeignLocale,
  observedLanguages,
  rulesFor,
} from "../typography/packs.js";
import { capAuditOnly, MAX_AUDIT_ONLY_PER_KIND } from "../typography/auditcap.js";
import { collectVariantPairs, SPELLING2019_CAVEAT } from "../typography/spelling2019.js";
import { capPivStems, collectPivStems, PIV2019_CAVEAT } from "../typography/piv2019.js";
import { assertExpectedDoc, EXPECTED_DOC_NAME_FIELD, fail, ok, type Tools } from "./shared.js";
import { APPLY_TIMEOUT_MS, backupStamp } from "./corrections.js";
import { withDiffs } from "./corrections.js";

export interface ContainerMatch extends RuleMatch {
  containerId: string;
  page: string;
}

/*
 * Fallback is the LAST page (`.at(-1)`), the same choice as in
 * corrections/planner.ts and (after alignment) in typography/spelling2019.ts.
 * It kicks in NOT on an empty pageRuns (there `.at(-1)` and `[0]` would give
 * the same undefined), but when the index lies OUTSIDE every run in a
 * NON-EMPTY pageRuns — a real, not hypothetical, state: overset text
 * (inspect.jsx sets oversetFrom to the end of the last run when
 * story.overflows) continues past the visible pages, and
 * corrections/planner.ts (warningsFor, `in-overset`) deliberately catches
 * such matches rather than discarding them. Invisible text logically
 * continues the LAST visible page, not the first — the same principle is
 * kept by all three places in the codebase.
 */
function pageAt(snapshot: ContainerSnapshot, index: number): string {
  for (const run of snapshot.pageRuns) {
    if (index >= run.start && index < run.end) return run.page;
  }
  return snapshot.pageRuns.at(-1)?.page ?? "?";
}

export interface ScanResult {
  matches: ContainerMatch[];
  /**
   * How many matches the language gate rejected. A separate field, not
   * silence: a rejected match is either foreign-language text (fine) or
   * broken language settings (bad), and only a human can tell one from the
   * other.
   */
  skippedByLanguage: number;
  /**
   * How many CONVENTION matches were dropped as belonging to another locale. A
   * separate counter rather than an addition to skippedByLanguage: the two
   * populations are different and must not be summed. skippedByLanguage counts
   * orthography, which REFUSES without language ranges; skippedByLocale counts
   * quotes and dashes, which ALLOW without them (locale.ts).
   */
  skippedByLocale: number;
}

/**
 * Master pages are skipped: their text repeats across dozens of pages, and a
 * mass edit there is a change to the template, not to the book's text.
 *
 * `langs` is optional exactly as long as none of the rules carry a
 * `language` field. As soon as such a rule exists and there are no ranges —
 * THROW: silent "no gate, write everything" is exactly the state the 2019
 * spelling phase was built against (spec §7).
 */
export function scanContainers(
  containers: ContainerSnapshot[],
  rules: TypographyRule[],
  langs?: ContainerLanguage[],
): ScanResult {
  const gated = rules.filter((r) => r.language !== undefined);
  if (gated.length > 0 && langs === undefined) {
    throw new Error(
      `Rules ${gated.map((r) => r.id).join(", ")} are bound to a language, but no language ` +
        "ranges were supplied. A run without the gate would rewrite foreign-language text " +
        "silently; nothing was done.",
    );
  }
  const byContainer = langs === undefined
    ? new Map<string, LanguageRun[]>()
    : mergedRuns(langs);
  /*
   * Cross-locale skipping engages only on a genuinely multi-family document —
   * see crossLocaleApplies() for the measured reason (a new InDesign document
   * defaults to "English: USA", so a Ukrainian book that was never relabelled
   * would otherwise have every convention match skipped).
   */
  const crossLocale = langs !== undefined && crossLocaleApplies(langs);

  const out: ContainerMatch[] = [];
  let skippedByLanguage = 0;
  let skippedByLocale = 0;
  for (const snapshot of containers) {
    if (snapshot.isMaster) continue;
    const runs = byContainer.get(snapshot.containerId);
    /*
     * Rules are run ONE AT A TIME, because the gate must be checked against
     * the language of THAT SPECIFIC rule that produced the match. The order
     * of matches within a container stays the same as before: a stable sort
     * by (start, end) separates exact-tie matches in the order of the rules
     * array — spaceBeforeBreak vs. collapseSpaces depends on this (comment
     * in rules-uk.ts).
     */
    const kept: RuleMatch[] = [];
    for (const rule of rules) {
      for (const m of runRules(snapshot.text, [rule])) {
        if (rule.language !== undefined
          && !fullyInLanguage(runs, m.start, m.end, rule.language)) {
          skippedByLanguage++;
          continue;
        }
        /*
         * The soft half of the gate: a convention match lying ENTIRELY inside a
         * language of another locale is not applied. This is what stops American
         * quotes from rewriting a Ukrainian quotation in a bilingual book, and
         * the reverse. On a document with no language markup it never fires
         * (packs.ts).
         */
        if (crossLocale && rule.locale !== undefined
          && inForeignLocale(runs, m.start, m.end, rule.locale)) {
          skippedByLocale++;
          continue;
        }
        kept.push(m);
      }
    }
    kept.sort((a, b) => a.start - b.start || a.end - b.end);
    for (const m of kept) {
      out.push({ ...m, containerId: snapshot.containerId, page: pageAt(snapshot, m.start) });
    }
  }
  return { matches: out, skippedByLanguage, skippedByLocale };
}

/**
 * A rule match is a range in a container, i.e. exactly what the existing
 * apply_edits handler already knows how to do. A separate JSX for
 * typography isn't needed, and by riding along with apply_edits the pass
 * inherits the document copy, a single history step, the pre-write text
 * check, and the heartbeat.
 */
export function toEdits(matches: ContainerMatch[]): AcceptedEdit[] {
  const accepted: ContainerMatch[] = [];
  const lastEnd = new Map<string, number>();

  for (const m of [...matches].sort(
    (a, b) => a.containerId.localeCompare(b.containerId) || a.start - b.start || b.end - a.end,
  )) {
    if (m.start < (lastEnd.get(m.containerId) ?? -1)) continue;
    accepted.push(m);
    lastEnd.set(m.containerId, m.end);
  }

  /*
   * I4 (final review): an empty replacement (m.after === "") is not a
   * "replace" with newText="", but a "delete". The only rule this affects
   * is spaceBeforeBreak (Task 11, replace: ""). This matches the convention
   * used across the rest of the codebase (src/tools/corrections.ts,
   * src/corrections/planner.ts): "delete" calls range.remove() in
   * src/jsx/apply.jsx, "replace" sets range.contents = newText. There's no
   * precedent anywhere in the code for range.contents = "" on a "replace";
   * leaving this combination untested against live InDesign would mean
   * relying on behavior no one has measured.
   */
  return accepted.map((m, i) => ({
    requestId: `typo-${m.ruleId}-${i}`,
    candidateId: `typo-${m.ruleId}-${i}#0`,
    containerId: m.containerId,
    start: m.start,
    end: m.end,
    expectedOld: m.before,
    newText: m.after,
    action: (m.after === "" ? "delete" : "replace") as "replace" | "delete",
  }));
}

export function registerTypographyTools(server: Tools): void {
  server.registerTool(
    "typography_audit",
    {
      title: "Typographic audit",
      description:
        "A run of the Ukrainian typographic rules over the whole document WITHOUT writing. It groups what it finds by rule: how many matches, a sample of examples with pages, and separately the doubtful matches that must be confirmed one by one. It additionally reports tabs used instead of indents and empty paragraphs — the tool does not fix those, because they are a decision about paragraph styles rather than about text. Changes nothing." +
        ` The auditOnly listing is truncated to ${MAX_AUDIT_ONLY_PER_KIND} places FOR EACH KIND separately ` +
        "(so that a rare kind is not crowded out by a frequent one), and auditOnlyTruncated then appears. " +
        "How many there really are is always in auditOnlyCounts, in full numbers: on a 196-page " +
        "book this listing accounted for 66,738 B of a 101,204 B response, which the client truncates." +
        " THE 2019 ORTHOGRAPHY — two halves with different behaviour, and the split is not ours: that is how " +
        "the Ministry of Education's own review split the changes. The MANDATORY half is the ordinary rules " +
        "(uk2019-proiekt, uk2019-compound, uk2019-sviashchennyk) in the shared groups; " +
        "they are bound to a language and fire ONLY where the match lies ENTIRELY " +
        "inside a Ukrainian range — «проект» inside a Russian quotation is " +
        "correct, and rewriting it would spoil the text silently. " +
        "The VARIANT half is a separate key, spelling2019, and it is NOT A RULE: it " +
        "has no replacement, so typography_apply physically has nothing to apply from it. " +
        "Both forms of every pair (ефір/етер, кафедра/катедра, Афіни/Атени…) " +
        "are legitimate; a finding is only a pair used in the document in BOTH forms — " +
        "a consistent edition has nothing to be accused of. The prevailing form is NOT " +
        "computed and is not declared the reference. The family is always enabled; ruleIds " +
        "narrows only the rules. The language is matched against the English name Ukrainian: " +
        "on a localised InDesign build all of this will silently yield zeros, which is why the " +
        "response carries ukrainianRuns — a zero there means “not measured”, not " +
        "“clean”. The tool CAN NOW REFUSE where it previously could not: broken " +
        "coverage of the language ranges invalidates the seam check, and that is deliberate." +
        " «ПІВ» (§ 36, item 6, Note) — also a separate key, piv2019, and also NOT " +
        "A RULE: there is no replacement, so typography_apply will likewise apply nothing " +
        "from it. A verdict (wrong/inventory) is issued ONLY where the orthography itself " +
        "issued one — a pre-reform apostrophe or hyphen after «пів», or a stem " +
        "from one of the source's two closed lists, written contrary to " +
        "the list. The absence of a verdict does NOT mean the spelling is correct — for " +
        "a stem outside both lists the tool does not know the “correct” spelling " +
        "in principle. Likewise a language-gated family: ukrainianRuns = 0 " +
        "means “not measured”, not “clean”.",
      inputSchema: {
        ruleIds: z
          .array(z.string())
          .optional()
          .describe("Which rules to run. Without this field — all of them."),
        sampleSize: z.number().int().min(1).max(50).default(10),
        locale: z
          .enum(["uk", "en-US", "en-GB"])
          .default("uk")
          .describe(
            "Which typographic school to audit against. uk — Ukrainian; en-US — Chicago " +
              "(curly double quotes, unspaced em dash); en-GB — Oxford (single outer quotes, " +
              "spaced en dash). The neutral core (spacing, apostrophe, ellipsis, numeric " +
              "ranges) is in all three.",
          ),
      },
    },
    async ({ ruleIds, sampleSize, locale = "uk" }) => {
      try {
        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read",
          {},
        );
        /*
         * The second bridge call is the language measurement at the SAME
         * offsets. The seam between the two calls is checked on ALL read
         * containers, before any filtering: an offset mismatch is a
         * measurement failure, and hiding it behind an audit filter would
         * narrow the safeguard down to only what we're already looking at
         * (the same sequence as in spelling_audit).
         *
         * A consequence spelled out in spec §6: typography_audit CAN NOW
         * THROW where it couldn't before. This is deliberate — a silent,
         * ungated overwrite is worse than a loud failure.
         */
        const langs = await readLanguageRuns();
        assertLanguageCoverage(read.containers, langs);

        const pack = rulesFor(locale as Locale);
        const rules = ruleIds ? pack.filter((r) => ruleIds.includes(r.id)) : pack;
        if (rules.length === 0) {
          throw new Error(
            `None of the rules was found in the ${locale} pack. ` +
              `Available in ${locale}: ${pack.map((r) => r.id).join(", ")}. ` +
              `Rule ids across all locales: ${allRuleIds().join(", ")}.`,
          );
        }

        const scan = scanContainers(read.containers, rules, langs);
        const audited = read.containers.filter((c) => !c.isMaster);
        const auditedIds = new Set(audited.map((c) => c.containerId));
        const auditedLangs = langs.filter((l) => auditedIds.has(l.containerId));
        /*
         * СТОРІНКА, А НЕ ЛИШЕ КОНТЕЙНЕР І ЗМІЩЕННЯ.
         *
         * `auditOnly` був єдиним блоком відповіді без номера сторінки: решта
         * (`groups`, `spelling2019`, `piv2019`) її дає через `pageAt`, і той
         * самий `pageAt` доступний тут-таки. Редактор, якому сказано
         * «табуляція на зміщенні 14 231 у story:12», не має куди піти —
         * зміщення в символах не є адресою на аркуші.
         */
        const findings = audited.flatMap((c) =>
          auditOnly(c.text).map((f) => ({
            ...f,
            containerId: c.containerId,
            page: pageAt(c, f.start),
          })),
        );
        const variants = collectVariantPairs(audited, auditedLangs, UK_LANGUAGE);
        const piv = collectPivStems(audited, auditedLangs, UK_LANGUAGE);

        /*
         * The `auditOnly` list was the one place in the response with no
         * ceiling, and exactly what made the tool unusable on the book:
         * 66,738 bytes out of 101,204 (measured 2026-08-16). It's truncated
         * PER KIND, so a rare kind isn't crowded out by a common one; the
         * full counts remain in `auditOnlyCounts`, and the truncation is
         * flagged in `auditOnlyTruncated`.
         */
        const capped = capAuditOnly(findings, MAX_AUDIT_ONLY_PER_KIND);
        /* Same shape as the line above: the ceiling lives in the leaf module,
         * where unit tests prove it, and the handler just calls it
         * (piv2019.ts). */
        const cappedStems = capPivStems(piv.stems);

        return ok({
          docName: read.docName,
          locale,
          /*
           * The raw language names exactly as InDesign returned them. They are in
           * the response so that A ZERO READS AS A ZERO: the gate relies on the
           * English names ("English: USA", "Ukrainian" — measured, locale.ts),
           * and on a build returning anything else the whole language half would
           * silently come back empty.
           */
          languages: {
            observed: observedLanguages(auditedLangs),
            /* Whether cross-locale skipping was in force at all. Reported because
             * `skippedByLocale: 0` is ambiguous otherwise — it could mean "nothing
             * foreign was found" or "the check never ran". */
            crossLocaleActive: crossLocaleApplies(auditedLangs),
            skippedByLocale: scan.skippedByLocale,
          },
          groups: groupByRule(scan.matches, sampleSize),
          totalMatches: scan.matches.length,
          auditOnly: capped.items,
          auditOnlyCounts: capped.counts,
          ...(capped.truncated ? { auditOnlyTruncated: capped.truncated } : {}),
          spelling2019: {
            /* Zero must read as zero, not as "clean": on a localized InDesign build
             * the language name won't match, and this whole half of the
             * 2019 spelling phase will silently return empty. */
            ukrainianRuns: countLanguageRuns(auditedLangs, UK_LANGUAGE),
            skippedByLanguage: scan.skippedByLanguage,
            pairs: variants.pairs,
            mixedCount: variants.mixedCount,
            caveat: SPELLING2019_CAVEAT,
          },
          piv2019: {
            ukrainianRuns: countLanguageRuns(auditedLangs, UK_LANGUAGE),
            stems: cappedStems.stems,
            stemsTruncated: cappedStems.hidden,
            wrongCount: piv.wrongCount,
            mixedCount: piv.mixedCount,
            /* The same key, a DIFFERENT population: here the denominator is only
             * matches of the «пів» pattern (matchPivForms), not all
             * language-gated 2019 rules as in spelling2019.skippedByLanguage
             * above. These two counters cannot be compared or summed with
             * each other. */
            skippedByLanguage: piv.skippedByLanguage,
            excludedNotNumeral: piv.excludedNotNumeral,
            caveat: PIV2019_CAVEAT,
          },
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "typography_apply",
    {
      title: "Applying the typographic rules",
      description:
        "Applies the chosen rules over the whole document as a single undo step. Confirmation is BY RULE, not by individual match: you name ruleIds after reviewing typography_audit. Doubtful matches (needs-review) are NOT applied by default — to take them too, enable includeNeedsReview. Before writing it saves a copy of the document in _backups/. The report says whether new overset appeared." +
        " The 2019 orthography rules write ONLY inside Ukrainian ranges; " +
        "a match crossing a language boundary is not applied and is counted separately " +
        "(skippedByLanguage). This reading of language ranges by a separate bridge call " +
        "happens only when the chosen ruleIds include at least one language-gated " +
        "2019 rule; for purely legacy rules (quotes-uk and the like) there is none " +
        "at all. When there is one, the tool CAN REFUSE if the language ranges " +
        "do not cover the document contiguously, exactly as typography_audit does.",
      inputSchema: {
        ruleIds: z.array(z.string()).min(1).describe("Rules confirmed after the audit."),
        includeNeedsReview: z
          .boolean()
          .default(false)
          .describe("Include doubtful matches too. Not by default."),
        undoName: z.string().default("Typographic rules"),
        locale: z
          .enum(["uk", "en-US", "en-GB"])
          .default("uk")
          .describe("The school whose pack the ruleIds are taken from. Must match the audit."),
        expectedDocName: EXPECTED_DOC_NAME_FIELD,
      },
    },
    async ({ ruleIds, includeNeedsReview, undoName, locale = "uk", expectedDocName }) => {
      try {
        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read",
          {},
        );
        assertExpectedDoc(read.docName, expectedDocName);
        const pack = rulesFor(locale as Locale);
        const rules = pack.filter((r) => ruleIds.includes(r.id));
        if (rules.length === 0) {
          throw new Error(
            `None of the rules was found in the ${locale} pack. ` +
              `Available in ${locale}: ${pack.map((r) => r.id).join(", ")}. ` +
              `Rule ids across all locales: ${allRuleIds().join(", ")}.`,
          );
        }

        /*
         * Reading language ranges is a separate bridge call, and not a
         * cheap one (measured ~0.85s per run). The gate rests on the RULE:
         * when none of the selected rules carry a `language` field, no
         * language-gated assertion will be written, so there's no reason to
         * read the ranges — and that's exactly why this is SAFE, not just
         * faster: scanContainers will throw on its own if a language-gated
         * rule reaches it without langs (verified above in this file), so
         * the guarantee doesn't rest on this `if` — it rests on the
         * downstream function throwing by itself. `langs` stays `undefined`
         * when there are no gated rules: a legacy rule (quotes-uk etc.) must
         * not pay the cost, and must not fail because of a language-range
         * seam that has nothing to do with its own request.
         */
        const hasGatedRule = rules.some((r) => r.language !== undefined);
        /*
         * Locale rules read the ranges too, but use them differently: a 2019 rule
         * REFUSES without them, a convention rule only USES them and can never
         * fail because of them. Hence the coverage assertion below is gated on
         * hasGatedRule alone — refusing over a language measurement a quote rule
         * does not need would be worse than not having it.
         */
        const hasLocaleRule = rules.some((r) => r.locale !== undefined);
        const langs = hasGatedRule || hasLocaleRule ? await readLanguageRuns() : undefined;
        if (hasGatedRule && langs !== undefined) assertLanguageCoverage(read.containers, langs);

        const scan = scanContainers(read.containers, rules, langs);
        const chosen = includeNeedsReview
          ? scan.matches
          : scan.matches.filter((m) => m.confidence === "high");
        const edits = toEdits(chosen);

        if (edits.length === 0) {
          return ok({ docName: read.docName, applied: 0, message: "Not a single match to apply." });
        }

        const report = await runWrite<ApplyReport>({
          handler: "apply_edits",
          params: {
            expectedDocName: read.docName,
            stamp: backupStamp(),
            undoName,
            edits: orderForApply(edits),
          },
          timeoutMs: APPLY_TIMEOUT_MS,
        });

        const outcome = withDiffs(report);
        return ok({
          docName: read.docName,
          rules: ruleIds,
          matched: scan.matches.length,
          attempted: edits.length,
          skippedNeedsReview: includeNeedsReview ? 0 : scan.matches.length - chosen.length,
          skippedByLanguage: scan.skippedByLanguage,
          skippedByLocale: scan.skippedByLocale,
          locale,
          ...outcome,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
