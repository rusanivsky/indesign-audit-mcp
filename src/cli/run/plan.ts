import { isNotApplicable, type AuditConfig, type FamilyName } from "../config/schema.js";

export interface Pass {
  id: FamilyName | "status" | "overview" | "preflight";
  tool: string;
  args: Record<string, unknown>;
  critical: boolean;
  timeoutHintMs: number;
}

export interface SkippedFamily {
  family: FamilyName;
  /**
   * A subfamily inside a family (e.g. `contents` in `pagination`), when
   * not the whole family but a single one of its parameters is declared
   * not applicable — ruling R29. `undefined` means the whole family is
   * declared, same as before F2.
   *
   * The field is OPTIONAL on purpose: family-level entries remain
   * literally the same objects as before, and none of their readers
   * (the report, `measurements.json`, the tests) need to know anything about subfamilies.
   */
  subfamily?: string;
  reason: string;
}

/**
 * Critical is what STOPS PRINTING (spec §6.4). The other families report,
 * but don't change the exit code: "there are findings" would fire always —
 * 497 unknown words are present in every run, and a gate that fires
 * constantly is not a gate.
 */
const CRITICAL_FAMILIES: ReadonlySet<FamilyName> = new Set<FamilyName>([
  "color",
  "geometry",
  "pagination",
]);

/**
 * Ordered from cheap to expensive (spec §6.3).
 *
 * `sequences` goes to `__cli_extras`, NOT to `pagination_audit` (ruling
 * R25, spec §4.4): `pagination_audit` doesn't accept `rules` at all — its
 * `inputSchema` (src/tools/pagination.ts) knows only `folio`/`contents`/
 * `runningHead`/`headingStyles`/`detail`, and without any of those the
 * tool itself refuses with «Не оголошено жодної родини». `rules` are the
 * numbers of the control table §10, which NO tool provides, and that is
 * exactly what the `__cli_extras` bridge (§4.4) exists for.
 *
 * `sequences` and `extras` sit here NEXT TO EACH OTHER, at the end: both
 * are add-ons through the same bridge, and `mergeCliExtras` below (after
 * `passes` is built) merges them into ONE pass when both are configured.
 */
const ORDER: ReadonlyArray<{ family: FamilyName; tool: string; timeoutHintMs: number }> = [
  { family: "color", tool: "color_audit", timeoutHintMs: 120_000 },
  { family: "geometry", tool: "geometry_audit", timeoutHintMs: 180_000 },
  { family: "typography", tool: "typography_audit", timeoutHintMs: 120_000 },
  { family: "styles", tool: "styles_audit", timeoutHintMs: 180_000 },
  { family: "pagination", tool: "pagination_audit", timeoutHintMs: 240_000 },
  { family: "bibliography", tool: "bibliography_audit", timeoutHintMs: 180_000 },
  { family: "spelling", tool: "spelling_audit", timeoutHintMs: 300_000 },
  /* 928 s measured on the 592-page "Зоряні Мрії" on 2026-08-18 (the
   * first time the pass ever reached the end at all — before that it kept
   * crashing on TextPath). 420 000 wasn't even enough for a 198-page book
   * (476 s): the limit sat BELOW the tool's own ceiling and cut it off
   * earlier than the tool would have stopped itself. */
  { family: "layout", tool: "layout_audit", timeoutHintMs: 1_800_000 },
  { family: "composition", tool: "composition_audit", timeoutHintMs: 600_000 },
  { family: "sequences", tool: "__cli_extras", timeoutHintMs: 180_000 },
  { family: "extras", tool: "__cli_extras", timeoutHintMs: 180_000 },
];

/**
 * Print numbers are mixed into the arguments EXPLICITLY (spec §5.4):
 * `color_audit` has its own `DEFAULTS.maxTotalInk = 300`, and letting it
 * fire would put a number nobody chose into the report.
 *
 * The `geometry` family in the edition config names the threshold
 * `nearMissPt` (spec §5.2) — a human name for the human writing the
 * config. The `geometry_audit` tool accepts the same threshold under a
 * different name — `nearMissThresholdPt` (verified by reading
 * `src/tools/geometry.ts:28`). Without renaming it here, the field would
 * silently land in `args` under the wrong key and the tool would get
 * `undefined` instead of the intended threshold.
 */
function buildArgs(
  family: FamilyName,
  settings: Record<string, unknown>,
  print: AuditConfig["print"],
): Record<string, unknown> {
  /*
   * TWO kinds of service keys are stripped, not one.
   *
   * `critical` — the operator's choice about the gate; the tool doesn't
   * know about it.
   *
   * `{"notApplicable": "…"}` ON A SUBFAMILY (F2, ruling R29) — the same
   * §5.1 dictionary, just one level below the family: `pagination.contents`
   * is declared not applicable. `pagination_audit` doesn't know about
   * `notApplicable`; `z.object(inputSchema)` would silently drop such a
   * key, but relying on that isn't safe — stage 1 (`reconcileWithToolSchemas`)
   * now checks the shape against `.strict()`, and an unstripped key would
   * become a REFUSAL. The reason isn't thrown away: `planPasses` below puts
   * it into `skipped`, and the report prints it verbatim under «Чого
   * перевірка НЕ бачила».
   */
  const rest = Object.fromEntries(
    Object.entries(settings).filter(([k, v]) => k !== "critical" && !isNotApplicable(v)),
  );
  switch (family) {
    case "color":
      return { ...rest, maxTotalInk: print.maxTotalInk, expectedInks: print.expectedInks };
    case "geometry": {
      const { nearMissPt, ...geometryRest } = rest;
      const geometryArgs: Record<string, unknown> = { ...geometryRest, minPpi: print.minPpi };
      if (nearMissPt !== undefined) geometryArgs.nearMissThresholdPt = nearMissPt;
      return geometryArgs;
    }
    default:
      return { ...rest };
  }
}

/**
 * C1: `extras` and `sequences` — two INDEPENDENT families (each can be
 * `notApplicable` on its own, spec §5.1), both go to the same
 * `__cli_extras` tool. Leaving them as two separate passes when BOTH are
 * configured would make the JSX handler (`src/jsx/cli-extras.jsx`) count
 * scale/pasteboard/hairline TWICE — and those very numbers would end up
 * under TWO different `id`s in `measurements.json`. `sections.ts`/
 * `audit.ts` key their adapters by `p.tool`, NOT by `p.id` — deliberately,
 * the same trick already used for `pagination`/`sequences` on
 * `pagination_audit` (`sections.ts:52-54`) — so both passes would land
 * under the ONE SAME string adapter, and every genuine finding (say, 66
 * paragraphs with scale ≠ 100 or 193 objects on the pasteboard) would be
 * duplicated in the report.
 *
 * Alternatives considered and rejected:
 * - Have the JSX handler distinguish calls (e.g. by the presence of
 *   `bodyTextStyles` vs `rules`) and return a PARTIAL `ExtrasMeasure`.
 *   Doesn't work: the eight existing `ExtrasMeasure` fields are REQUIRED
 *   (not `?`), and for a call that didn't ask for them, we'd either have
 *   to invent zero values (that is exactly the "silent zero" that §5.4/§8
 *   explicitly forbid: "Horizontal scale: all 100%" on a pass that never
 *   measured scale at all is a lie presented as a measurement), or make all
 *   eight fields optional — but C3 asks for exactly ONE new field, not a
 *   rework of the existing eight.
 * - Give `sequences` its own synthetic tool (e.g. `__cli_sequences`) that
 *   internally also calls `runJsx("__cli_extras", …)`. That would indeed
 *   distinguish `p.tool`, but `sections.ts`/`audit.ts` would then have no
 *   adapter at all for this new tool (the adapters there are listed
 *   explicitly by name) — `sequences` findings wouldn't disappear
 *   SILENTLY (there's a branch for "pass ran, but the report doesn't parse
 *   it" — R18), but fixing that is outside C1-C6 (editing
 *   sections.ts/audit.ts isn't in scope here).
 *
 * The chosen solution is merging: when BOTH families are configured, their
 * arguments are merged into ONE pass (`bodyTextStyles` alongside `rules`),
 * `critical` is a logical OR. The pass stays under `id: "extras"` (the
 * first of the two families, which already existed on its own before this
 * task). When only ONE of the two is configured, this function doesn't
 * touch anything — the pass stays single, as for any other family.
 *
 * A cost of this decision, ALREADY CLOSED (Important 3, fix round 1): when
 * ONLY `sequences` is configured (and `extras` is `notApplicable`), a
 * lone `sequences` pass would still walk the ENTIRE `__cli_extras` traversal
 * regardless — including `forcedBreaks.inBodyText`, which would count `0`
 * WITHOUT a supplied `bodyTextStyles` (a fake zero presented as a
 * measurement), and those numbers would be published under `id:
 * "sequences"`, while `notSeen` simultaneously says "extras wasn't
 * checked". This function deliberately does NOT fix that itself: merging is
 * a question of the pass's FORM (paired or not), not a question of whether
 * the config's state itself is LEGAL. That state is forbidden one level
 * earlier — `validateConfig` (`src/cli/config/validate.ts`,
 * `checkSequencesExtrasConsistency`) refuses if `sequences` is configured
 * while `extras` is `notApplicable`, precisely because both go through
 * this same one pass. `planPasses`, called DIRECTLY (bypassing
 * `validateConfig` — which is how this file's unit tests do it), doesn't
 * inherit that ban: a lone `sequences` pass remains technically possible
 * here, that's deliberate, and it's covered by a test.
 */
function mergeCliExtras(passes: Pass[]): void {
  const extrasIdx = passes.findIndex((p) => p.id === "extras");
  const seqIdx = passes.findIndex((p) => p.id === "sequences");
  if (extrasIdx === -1 || seqIdx === -1) return;
  const extrasPass = passes[extrasIdx]!;
  const seqPass = passes[seqIdx]!;
  extrasPass.args = { ...extrasPass.args, ...seqPass.args };
  extrasPass.critical = extrasPass.critical || seqPass.critical;
  passes.splice(seqIdx, 1);
}

export function planPasses(cfg: AuditConfig): { passes: Pass[]; skipped: SkippedFamily[] } {
  const passes: Pass[] = [
    { id: "status", tool: "indesign_status", args: {}, critical: false, timeoutHintMs: 30_000 },
    /*
     * doc_overview — always runs, alongside status (spec §4.3, row 1 of
     * the pass table: "indesign_status + doc_overview"). Non-critical: the
     * gate (fonts, links) is already covered by preflight_document, and
     * doc_overview here is informational — it supplies numbers for the
     * report (extent, format, bleeds, link ppi) that four rows of the
     * §10 regression control table rest on.
     */
    { id: "overview", tool: "doc_overview", args: {}, critical: false, timeoutHintMs: 60_000 },
    /* The [Basic] profile has six rules enabled out of 38 — so ALL of the
     * document's profiles are needed, not just the working one (spec §4.3). */
    { id: "preflight", tool: "preflight_document", args: {}, critical: true, timeoutHintMs: 180_000 },
  ];
  const skipped: SkippedFamily[] = [];

  for (const { family, tool, timeoutHintMs } of ORDER) {
    const state = cfg.families[family];
    if (isNotApplicable(state)) {
      skipped.push({ family, reason: state.notApplicable });
      continue;
    }
    const settings = state as Record<string, unknown>;
    /*
     * F2/R29: a subfamily declared not applicable lands in `skipped`
     * ALONGSIDE the families — the same list the report already knows how
     * to print. A second mechanism for the same idea would have diverged
     * from the first. The family's pass still RUNS in this case: it's one
     * subfamily that's not applicable, not the whole family (`pagination`
     * still measures folio and runningHead).
     */
    for (const [key, value] of Object.entries(settings)) {
      if (isNotApplicable(value)) {
        skipped.push({ family, subfamily: key, reason: value.notApplicable });
      }
    }
    passes.push({
      id: family,
      tool,
      args: buildArgs(family, settings, cfg.print),
      critical: settings.critical === true || CRITICAL_FAMILIES.has(family),
      timeoutHintMs,
    });
  }

  mergeCliExtras(passes);

  return { passes, skipped };
}
