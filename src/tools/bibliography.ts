import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { runWrite } from "../bridge/envelope.js";
import { orderForApply } from "../corrections/planner.js";
import type { AcceptedEdit, ApplyReport, ContainerSnapshot } from "../corrections/types.js";
import {
  DEFAULT_RECORD_DISCRIMINATOR,
  DEFAULT_RECORD_PATTERN,
  segmentContainer,
} from "../bibliography/segment.js";
import { parseRecord } from "../bibliography/parse.js";
import { segmentChicago } from "../bibliography/segment-chicago.js";
import { parseChicago } from "../bibliography/parse-chicago.js";
import { CHICAGO_RULES } from "../bibliography/rules-chicago.js";
import { measureUniformity } from "../bibliography/uniformity.js";
import { DSTU_RULES, type Standard } from "../bibliography/rules-dstu.js";
import { collectNbspCandidates, nbspFindings, type NbspCandidate } from "../bibliography/rules-nbsp.js";
import { readNoBreak } from "../bibliography/nobreak.js";
import { buildReport } from "../bibliography/report.js";
import type { Finding, ParsedRecord, SkippedParagraph } from "../bibliography/types.js";
import { assertExpectedDoc, EXPECTED_DOC_NAME_FIELD, fail, ok, type Tools } from "./shared.js";
import { APPLY_TIMEOUT_MS, backupStamp, withDiffs } from "./corrections.js";

/**
 * `standard` names the standard; `layers` names the layers.
 *
 * The enum used to mix the two — `"dstu"` is a standard, `"nbsp"` is a layer.
 * With two standards that was merely untidy. With three it becomes a
 * contradiction a caller can actually express: `standard: "chicago", layers:
 * ["dstu"]`. Renaming the member makes the contradiction unrepresentable
 * instead of merely discouraged.
 */
export type Layer = "standard" | "nbsp";

/** `"dstu"` stays accepted as a deprecated alias, so existing calls keep working. */
export function normaliseLayers(input: readonly string[]): Layer[] {
  return input.map((l) => (l === "dstu" ? "standard" : l)) as Layer[];
}

/**
 * The tool boundary is wider than `Standard`, and deliberately so.
 *
 * `Standard` feeds `DSTU_RULES.check(parsed, standard)`. A third member there
 * would hand every ДСТУ rule a value it has no branch for, and the miss would
 * be silent — the rule would simply take its `else`. Keeping the union at two
 * and widening only at the boundary turns that hazard into a compile error.
 */
export type AuditStandard = Standard | "chicago";

export interface AuditCollection {
  records: number;
  unparsed: number;
  parsed: ParsedRecord[];
  skipped: SkippedParagraph[];
  numberingGaps: Array<{ after: number; next: number }>;
  /** Findings of the CHOSEN standard's family — ДСТУ or Chicago. */
  standardFindings: Finding[];
  nbspCandidates: NbspCandidate[];
}

/**
 * All the work that does NOT need InDesign. Split out for exactly this
 * reason: it lets the tool be covered by unit tests without a live
 * application — the same boundary src/typography/ holds.
 */
export function collectAudit(
  containers: ContainerSnapshot[],
  opts: {
    standard: AuditStandard;
    layers: Layer[];
    ruleIds?: string[];
    recordPattern?: string;
    recordDiscriminator?: string;
  },
): AuditCollection {
  const parsed: ParsedRecord[] = [];
  const skipped: SkippedParagraph[] = [];
  const numberingGaps: Array<{ after: number; next: number }> = [];
  const chicago = opts.standard === "chicago";

  for (const c of containers) {
    /*
     * The segmenter is chosen by the standard, not shared between them. A
     * Chicago bibliography is unnumbered, and the ДСТУ segmenter opens a
     * record only on a numbered paragraph — which is why this edition measured
     * `records: 0` with 1866 paragraphs filed as headings before this branch
     * existed.
     */
    const seg = chicago
      ? segmentChicago(c, {
          ...(opts.recordPattern ? { recordPattern: opts.recordPattern } : {}),
          ...(opts.recordDiscriminator ? { recordDiscriminator: opts.recordDiscriminator } : {}),
        })
      : segmentContainer(c, {
          recordPattern: opts.recordPattern ?? DEFAULT_RECORD_PATTERN,
          recordDiscriminator: opts.recordDiscriminator ?? DEFAULT_RECORD_DISCRIMINATOR,
        });
    skipped.push(...seg.skipped);
    numberingGaps.push(...seg.numberingGaps);
    for (const r of seg.records) parsed.push(chicago ? parseChicago(r) : parseRecord(r));
  }

  const wanted = (id: string): boolean =>
    opts.ruleIds === undefined || opts.ruleIds.includes(id);

  let standardFindings: Finding[] = [];
  if (opts.layers.includes("standard")) {
    if (opts.standard === "chicago") {
      const rules = CHICAGO_RULES.filter((r) => wanted(r.id));
      standardFindings = parsed.flatMap((p) => rules.flatMap((r) => r.check(p)));
    } else {
      /*
       * `opts.standard` is narrowed to `Standard` HERE, by the compiler. This
       * is the one place the hazard is disarmed: the narrowing must come from
       * comparing `opts.standard` itself — a boolean like `chicago` above
       * cannot narrow a union, and writing `if (!chicago)` would silently hand
       * ДСТУ rules a value they have no branch for.
       */
      const std: Standard = opts.standard;
      const rules = DSTU_RULES.filter((r) => wanted(r.id));
      standardFindings = parsed.flatMap((p) => rules.flatMap((r) => r.check(p, std)));
    }
  }

  const nbspCandidates = opts.layers.includes("nbsp")
    ? collectNbspCandidates(parsed).filter((c) => wanted(c.ruleId))
    : [];

  return {
    records: parsed.length,
    unparsed: parsed.filter((p) => p.unparsed !== null).length,
    parsed,
    skipped,
    numberingGaps,
    standardFindings,
    nbspCandidates,
  };
}

/**
 * A loud contract for `nbspFindings` (rules-nbsp.ts): `attributeAnswers`
 * must be the same array in LENGTH and ORDER as `candidates`, because the
 * answers come from `readNoBreak` as a separate batched bridge call, not
 * type-bound to the candidates.
 *
 * Task 9 review: inside, `nbspFindings` does `attributeAnswers[i] ??
 * false` — meaning a shorter array SILENTLY means "unprotected" for every
 * extra candidate, and instead of a visible failure, thousands of false
 * findings appear for no apparent reason. This check is the one place in
 * the tool where the bridge's answer meets the candidate list, so it's
 * exactly here that the mismatch must fail loudly, not dissolve into the
 * report.
 */
export function assertNoBreakAnswersMatch(candidatesLength: number, answersLength: number): void {
  if (candidatesLength !== answersLength) {
    throw new Error(
      `Internal mismatch: readNoBreak returned ${answersLength} answers for ` +
        `${candidatesLength} nbsp candidates. Nothing has been changed; the protection cannot be reconciled.`,
    );
  }
}

/**
 * Spec §8: a rule id that exists in no family must be REPORTED, not silently
 * dropped. Filtering by an unknown id yields an empty rule list, which yields
 * zero findings — indistinguishable from "the document is clean". The error
 * names what IS available, the way `typography_apply` does.
 */
export function assertKnownRules(standard: AuditStandard, ruleIds: readonly string[]): void {
  const available =
    standard === "chicago" ? CHICAGO_RULES.map((r) => r.id) : DSTU_RULES.map((r) => r.id);
  const unknown = ruleIds.filter((id) => !available.includes(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown rule id(s) for standard ${standard}: ${unknown.join(", ")}. ` +
        `Available for ${standard}: ${available.join(", ")}. Nothing has been changed.`,
    );
  }
}

/**
 * The gate that exists because confirmation is BY RULE, not by match.
 *
 * Rule-level confirmation is sound while a rule's matches are trusted, and
 * dangerous when the segmenter might have opened entries nobody reviewed —
 * which is exactly the risk the Chicago discriminator carries on a book whose
 * prose contains years. Refusing on a count mismatch turns "the document
 * changed under you" from silent edits into a stop.
 */
export function assertExpectedRecords(measured: number, requested: number): void {
  if (measured !== requested) {
    throw new Error(
      `The audit is being applied against ${requested} record(s), but ${measured} were found now. ` +
        `Nothing has been changed. Re-run bibliography_audit and pass the count it reports.`,
    );
  }
}

/**
 * Findings → edits. `Finding` already carries container coordinates, so this
 * is a translation rather than a computation; the only decisions here are
 * overlap resolution and the delete/replace distinction.
 */
export function bibFindingsToEdits(findings: readonly Finding[]): AcceptedEdit[] {
  const accepted: Finding[] = [];
  const lastEnd = new Map<string, number>();

  for (const f of [...findings].sort(
    (a, b) => a.containerId.localeCompare(b.containerId) || a.start - b.start || b.end - a.end,
  )) {
    if (f.start < (lastEnd.get(f.containerId) ?? -1)) continue;
    accepted.push(f);
    lastEnd.set(f.containerId, f.end);
  }

  return accepted.map((f, i) => ({
    requestId: `bib-${f.ruleId}-${i}`,
    candidateId: `bib-${f.ruleId}-${i}#0`,
    containerId: f.containerId,
    start: f.start,
    end: f.end,
    expectedOld: f.before,
    newText: f.suggested,
    /*
     * An empty replacement is a DELETE, not a "replace" with newText="". This
     * follows the convention the rest of the codebase holds (corrections/
     * planner.ts, jsx/apply.jsx): "delete" calls range.remove(), "replace"
     * assigns range.contents. There is no precedent anywhere for
     * `range.contents = ""`, and relying on unmeasured InDesign behaviour is
     * exactly what this project does not do.
     */
    action: f.suggested === "" ? "delete" : "replace",
  }));
}

export function registerBibliographyTools(server: Tools): void {
  server.registerTool(
    "bibliography_audit",
    {
      title: "Bibliographic description audit",
      description:
        "A check of the bibliographic description rules for editions of the “bibliographic index” type and " +
        "editions carrying a bibliography. THREE STANDARDS: ДСТУ ГОСТ 7.1:2006 and ДСТУ 8302:2015 " +
        "for Ukrainian material, and the Chicago Manual of Style for English-language material. " +
        "APA, MLA, ISO 690 and Harvard are NOT implemented — material in those styles is judged by " +
        "the standard you name, which is the wrong answer, not no answer. Chicago has its OWN " +
        "segmenter, because a Chicago bibliography is unnumbered while the ДСТУ segmenter opens a " +
        "record only on a numbered paragraph; on an English edition the ДСТУ path therefore finds " +
        "zero records rather than wrong ones. Chicago entries are skipped where the text carries " +
        "Cyrillic, and the skip says so by reason, so an inert run is distinguishable from a clean " +
        "one. Chicago is a CITATION style: it governs how a source is described, NOT what a " +
        "copyright page must contain — that is a cataloguing requisite (ДСТУ 4861 in Ukraine, an " +
        "LC CIP block in the USA) and no rule here produces one. " +
        "The norm is set by the STANDARD (ДСТУ ГОСТ 7.1:2006 for " +
        "an index and a bibliography, ДСТУ 8302:2015 for a list of sources in an academic " +
        "work), not by the majority in the document: 7.1 requires the zone separator “full stop and dash” " +
        "(U+2013), whereas 8302 advises replacing that mark with a plain full stop. The same " +
        "divergence under different standard values yields OPPOSITE proposals — which is why this field is mandatory " +
        "rather than guessed from the text. Separately it measures UNIFORMITY — whether a defect is systematic (one replacement for " +
        "the whole document) or scattered (fixed one by one). It checks non-breaking spaces by BOTH " +
        "mechanisms: the U+00A0 character and the noBreak attribute (a GREP style), because checking only " +
        "characters on an edition with a GREP style yields thousands of false positives. Changes nothing: " +
        "not a single write to the document.",
      inputSchema: {
        standard: z
          .enum(["7.1", "8302", "chicago"])
          .default("7.1")
          .describe(
            "7.1 — a Ukrainian index and bibliography; 8302 — a Ukrainian list of sources in an " +
              "academic work; chicago — the Chicago Manual of Style bibliography-entry form for " +
              "English-language material.",
          ),
        layers: z
          .array(z.enum(["standard", "nbsp", "dstu"]))
          .default(["standard", "nbsp"])
          .describe(
            "Which layers of rules to run. \"standard\" is the chosen standard's own family; " +
              "\"dstu\" is a DEPRECATED alias for it, kept so older calls keep working.",
          ),
        ruleIds: z.array(z.string()).optional().describe("Which rules to run. Without this field — all of them."),
        recordPattern: z.string().optional().describe("The record number pattern."),
        recordDiscriminator: z
          .string()
          .optional()
          .describe("What distinguishes a record from a heading: a zone separator or a year."),
        sampleSize: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ standard, layers, ruleIds, recordPattern, recordDiscriminator, sampleSize }) => {
      try {
        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read",
          {},
        );
        const collected = collectAudit(read.containers, {
          standard,
          layers: normaliseLayers(layers),
          ...(ruleIds ? { ruleIds } : {}),
          ...(recordPattern ? { recordPattern } : {}),
          ...(recordDiscriminator ? { recordDiscriminator } : {}),
        });

        /* The noBreak attribute is read as ONE targeted batch — not by scanning. */
        const answers = await readNoBreak(
          collected.nbspCandidates.map((c) => ({
            containerId: c.parsed.record.containerId,
            start: c.parsed.record.start + c.localStart,
            end: c.parsed.record.start + c.localEnd,
          })),
        );
        assertNoBreakAnswersMatch(collected.nbspCandidates.length, answers.length);

        const findings = [
          ...collected.standardFindings,
          ...nbspFindings(collected.nbspCandidates, answers),
        ];

        return ok({
          docName: read.docName,
          standard,
          numberingGaps: collected.numberingGaps,
          ...buildReport({
            findings,
            uniformity: measureUniformity(collected.parsed),
            skipped: collected.skipped,
            records: collected.records,
            unparsed: collected.unparsed,
            sampleSize,
          }),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "bibliography_apply",
    {
      title: "Applying the bibliographic rules",
      description:
        "Applies the chosen bibliographic rules over the whole document as a single undo step. " +
        "Confirmation is BY RULE, not by individual match: you name ruleIds after reviewing " +
        "bibliography_audit, and `standard` must be the SAME one the audit ran under — a rule id " +
        "belonging to another standard's family is refused by name, not silently dropped. " +
        "Doubtful matches (needs-review) are NOT applied by default; to take them too, enable " +
        "includeNeedsReview. Two Chicago rules are needs-review BY CONSTRUCTION and should be read " +
        "before being enabled: chicago-extent can delete a live page-number marker (in a CIP block " +
        "the extent is often not a literal at all), and chicago-publisher-caps can overwrite the " +
        "house's own form of its name, which the copyright block usually sets in full caps on " +
        "purpose. " +
        "expectedRecords is MANDATORY and is checked against the live count before anything is " +
        "written: rule-level confirmation is only safe while the record set is the one you " +
        "reviewed, and the Chicago segmenter can open an entry in prose that carries a year. " +
        "Before writing, a copy of the document is saved in _backups/. " +
        "The nbsp layer is NOT applied here: those findings need the noBreak answers that only the " +
        "audit path collects, and writing them without that reconciliation is the very mismatch " +
        "assertNoBreakAnswersMatch exists to prevent.",
      inputSchema: {
        ruleIds: z.array(z.string()).min(1).describe("Rules confirmed after the audit."),
        standard: z
          .enum(["7.1", "8302", "chicago"])
          .default("7.1")
          .describe("The standard whose family the ruleIds come from. Must match the audit."),
        expectedRecords: z
          .number()
          .int()
          .min(0)
          .describe("The record count the audit reported. A mismatch refuses the write."),
        includeNeedsReview: z
          .boolean()
          .default(false)
          .describe("Include doubtful matches too. Not by default."),
        undoName: z.string().default("Bibliographic rules"),
        expectedDocName: EXPECTED_DOC_NAME_FIELD,
      },
    },
    async ({ ruleIds, standard, expectedRecords, includeNeedsReview, undoName, expectedDocName }) => {
      try {
        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read",
          {},
        );
        assertExpectedDoc(read.docName, expectedDocName);
        assertKnownRules(standard, ruleIds);

        const collected = collectAudit(read.containers, {
          standard,
          layers: ["standard"],
          ruleIds,
        });
        assertExpectedRecords(collected.records, expectedRecords);

        const chosen = includeNeedsReview
          ? collected.standardFindings
          : collected.standardFindings.filter((f) => f.confidence === "high");
        const edits = bibFindingsToEdits(chosen);
        if (edits.length === 0) {
          return ok({
            docName: read.docName,
            standard,
            records: collected.records,
            applied: 0,
            message: "Not a single match to apply.",
          });
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

        return ok({
          docName: read.docName,
          standard,
          rules: ruleIds,
          records: collected.records,
          matched: collected.standardFindings.length,
          attempted: edits.length,
          skippedNeedsReview: includeNeedsReview
            ? 0
            : collected.standardFindings.length - chosen.length,
          ...withDiffs(report),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
