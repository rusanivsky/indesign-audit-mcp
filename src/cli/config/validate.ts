import { z } from "zod";
import { planPasses } from "../run/plan.js";
import { UNCONFIRMED, unfilledSpots } from "./scaffold.js";
import { auditConfigSchema, FAMILY_NAMES, isNotApplicable, type AuditConfig } from "./schema.js";
/* A TYPE-ONLY import on purpose: `ToolBox` is needed only for the signature, and after
 * compilation no `import` of it remains — meaning this module still physically doesn't drag
 * in the bridge to InDesign, nor `child_process`
 * (the test `cli-config-validate.test.ts` guards exactly this). The box itself is created by
 * the caller (`src/cli/audit.ts`, `collectTools()`) — it too costs zero:
 * the registrars just assemble handlers into a Map. */
import type { ToolBox } from "../collect.js";

/**
 * A rejection must TEACH, not just reject: four things — which family,
 * which key, what it's for, and why there's no default.
 */
export class ConfigError extends Error {
  constructor(
    readonly family: string | null,
    readonly key: string | null,
    readonly purpose: string,
    readonly whyNoDefault: string,
  ) {
    const parts = [family, key].filter((s) => s !== null).join(".");
    super(
      `Config is invalid: ${parts || "the root"}\n` +
        `Purpose: ${purpose}\n` +
        `Why there's no default: ${whyNoDefault}`,
    );
    this.name = "ConfigError";
  }
}

/** An explanation for every key that has no default and must never have one. */
const EXPLANATIONS: Record<string, { purpose: string; whyNoDefault: string }> = {
  "print.minPpi": {
    purpose: "the effective image-resolution threshold",
    whyNoDefault: "300 for offset and 150 for digital is decided by the PRINTER, not the tool",
  },
  "print.maxTotalInk": {
    purpose: "the total ink coverage limit",
    whyNoDefault: "the limit depends on the paper and the press — that's the PRINTER's decision",
  },
  "print.expectedInks": {
    purpose: "how many inks are expected in the print run",
    whyNoDefault: "four or five inks is the publication's decision, not a property of the file",
  },
};

const WHAT_TO_DO_WITH_FAMILY =
  "Either name its parameters, or declare it not applicable: " +
  '{"notApplicable": "why exactly"}. Silence is forbidden — it makes ' +
  "zero findings indistinguishable from 'wasn't asked'.";

/**
 * Important 3 (fix round 1, task C): `sequences` and `extras` —
 * BOTH route to the single tool `__cli_extras` (spec §4.4, ruling R25,
 * `src/cli/run/plan.ts`, `mergeCliExtras`). When both are configured, their
 * arguments merge into ONE pass and no side numbers arise.
 * But when `sequences` is configured and `extras` is `notApplicable`,
 * the single `sequences` pass STILL performs the ENTIRE `__cli_extras` sweep
 * (scale, pasteboard, point size, page format, `forcedBreaks`) — this can't
 * be partially disabled, the handler counts everything in one pass. These side
 * numbers get published under `id: "sequences"` (`sections.ts`/`audit.ts`
 * key the adapter by `p.tool`, not by `p.id` — on purpose), while `notSeen`
 * SIMULTANEOUSLY says «family «extras»: Declared not applicable». Worst of all —
 * `forcedBreaks.inBodyText` counts as `0` not because there are no breaks, but
 * because there's no one to hand `bodyTextStyles` to: a false zero, presented as
 * a measurement, exactly what this section exists to guard against.
 *
 * The state is LEGAL per spec §5.1 (each family is its own independent triple of
 * states) — so this is NOT a shape error (the branch below doesn't catch this
 * combination). But a report that says "not checked" while simultaneously printing
 * numbers isn't trustworthy. The cheaper, honest fix is an explicit rejection:
 * "sequences" requires that `extras` also be configured (not `notApplicable`),
 * as long as both route through the same pass.
 */
function checkSequencesExtrasConsistency(cfg: AuditConfig): void {
  const sequences = cfg.families.sequences;
  const extras = cfg.families.extras;
  if (isNotApplicable(sequences)) return;
  if (!isNotApplicable(extras)) return;
  throw new ConfigError(
    "sequences",
    null,
    "sequences and extras run in ONE __cli_extras pass (spec §4.4); " +
      "when extras is notApplicable, a lone sequences pass still counts " +
      "scale/pasteboard/forcedBreaks and publishes them under sequences, while " +
      "forcedBreaks.inBodyText comes out a false zero without bodyTextStyles",
    "the extras family must be CONFIGURED (not notApplicable) as long as both " +
      "run through one tool — otherwise the report simultaneously says 'extras wasn't " +
      "checked' and prints extras' numbers under a different pass name",
  );
}

/**
 * §3.3 of the handoff: `sequences.rules: []` — a state WORSE than `notApplicable`.
 *
 * WHAT IT DID. The family is declared, the pass is planned and executed, the entire
 * `__cli_extras` sweep gets paid for — but there's nothing to check: the JSX takes
 * `if (params.rules && params.rules.length > 0)`, so `out.sequences` doesn't
 * appear in the result AT ALL. Then `sections.ts` reads
 * `(d.sequences ?? [])` and gets zero problems. The family doesn't land in
 * "clean" (there's nothing to ask about it there), nor in "not seen", nor in "needs
 * eyes" — it simply vanishes. `notApplicable`, by contrast, at least prints a reason.
 *
 * WHY A REJECTION, NOT A DEFAULT. There is no default list of sequences:
 * «Нумерація питань» is THIS edition's style, and it cannot be invented on the
 * user's behalf. An empty list has no legitimate reading other than "I declared the
 * family and didn't say what to check" — and the config already has an exact form
 * for that.
 */
function checkSequencesNotEmpty(cfg: AuditConfig): void {
  const sequences = cfg.families.sequences;
  if (isNotApplicable(sequences)) return;
  if (typeof sequences !== "object" || sequences === null) return;
  /*
   * A MISSING KEY IS ALSO AN EMPTY LIST, and this isn't pedantry.
   *
   * The first version of this gate only asked `rules.length === 0`, so
   * `"sequences": {}` slipped through it silently — and that's a MORE NATURAL
   * way to write "nothing here" than an empty array. From there the state is
   * exactly the one the gate was written against: the JSX takes
   * `params.rules && params.rules.length > 0`, `out.sequences` doesn't appear,
   * and the family vanishes from the report. Found by a hostile review of the
   * branch.
   */
  const rules = (sequences as Record<string, unknown>).rules;
  const empty = rules === undefined || (Array.isArray(rules) && rules.length === 0);
  if (!empty) return;
  throw new ConfigError(
    "sequences",
    "rules",
    "the sequences family is declared with an empty rule list: the pass will run, " +
      "pay for the whole document walk, check nothing, and disappear from the report " +
      "entirely — not in 'clean', not in 'not seen', not in 'needs eyes'",
    'either list the rules (each with its own style), or declare the family ' +
      'not applicable with a reason: {"notApplicable": "…"} — then the reason will at least ' +
      "be printed in the 'What The Check Didn't See' section",
  );
}

/**
 * Degree 1: the schema itself. No calls to InDesign at all — so a rejection
 * here costs zero. Degree 2 (checking style names against the document) is
 * separate, after opening the document.
 */
export function validateConfig(raw: unknown): AuditConfig {
  const parsed = auditConfigSchema.safeParse(raw);
  if (parsed.success) {
    /*
     * A `--init` draft ships out with `UNCONFIRMED` markers wherever the
     * decision belongs to a human (which style is the folio, which is the
     * body text). They pass the schema — they're ordinary strings — so only
     * a separate check can stop them, and it has to stand right here, at
     * degree 1: before any touch of InDesign.
     *
     * Without it, an incompletely filled-in draft would reach degree 2 and
     * fail there with "style „<?>“ doesn't exist in the document" — also a
     * rejection, but with a false cause: a human would read it as a document
     * problem, not as their own unfilled cell. The price of the correct cause
     * here is five lines.
     */
    const unfilled = unfilledSpots(parsed.data);
    if (unfilled.length > 0) {
      return raise(
        new ConfigError(
          null,
          null,
          `config is not fully filled in yet: ${unfilled.length} placeholder(s) "${UNCONFIRMED}" — ` +
            unfilled.join(", "),
          "This is an --init draft. Replace each placeholder with a style name from this document " +
            "(the list was printed by --init next to the file), or declare the family not applicable " +
            'with a reason: {"notApplicable": "…"}.',
        ),
      );
    }
    checkSequencesExtrasConsistency(parsed.data);
    checkSequencesNotEmpty(parsed.data);
    return parsed.data;
  }

  const issue = parsed.error.issues[0]!;
  const path = issue.path.map(String);

  /*
   * zod 4 (MEASURED, not from memory of v3): an unknown key in the `.strict()`
   * families object produces ONE issue with code === "unrecognized_keys",
   * path === ["families"] (no family name in path!) and the names themselves
   * sit in issue.keys. Looking for the family at path[1] here would always give null.
   */
  if (issue.code === "unrecognized_keys" && path[0] === "families") {
    const family = issue.keys[0] ?? null;
    return raise(
      new ConfigError(
        family,
        null,
        `unknown family; known ones: ${FAMILY_NAMES.join(", ")}`,
        WHAT_TO_DO_WITH_FAMILY,
      ),
    );
  }

  /* The family is missing, or its value doesn't match either of the two forms
   * (parameter object / { notApplicable }) — path === ["families", name]. */
  if (path[0] === "families" && path.length >= 2) {
    const family = path[1] ?? null;
    const known = family !== null && (FAMILY_NAMES as readonly string[]).includes(family);
    return raise(
      new ConfigError(
        family,
        null,
        known
          ? "audit-pass family"
          : `unknown family; known ones: ${FAMILY_NAMES.join(", ")}`,
        WHAT_TO_DO_WITH_FAMILY,
      ),
    );
  }

  const key = path.join(".");
  const explanation = EXPLANATIONS[key];
  if (explanation !== undefined) {
    return raise(
      new ConfigError(
        path[0] ?? null,
        path.slice(1).join(".") || null,
        explanation.purpose,
        explanation.whyNoDefault,
      ),
    );
  }

  return raise(
    new ConfigError(
      path[0] ?? null,
      path.slice(1).join(".") || null,
      issue.message,
      "parameter is required by the schema",
    ),
  );
}

/** Kept separate so `validateConfig` stays an expression with a single return type. */
function raise(e: ConfigError): never {
  throw e;
}

/* ==========================================================================
 * DEGREE 1, SECOND HALF: a family's shape against the REAL `inputSchema`
 * of its tool (ruling R30).
 * ========================================================================== */

/** Passes that are NOT config families (status/overview/preflight) are not subject to reconciliation. */
const FAMILIES: ReadonlySet<string> = new Set<string>(FAMILY_NAMES);

/** "What it's for" comes from the schema's own `.describe()`, not from a paraphrase alongside it. */
function describe(shape: z.ZodRawShape, field: string | undefined): string | null {
  if (field === undefined) return null;
  /* `z.ZodRawShape` in zod 4 is typed as `Record<string, $ZodType>` — the base
   * type without `.description`; the getter itself does exist on the instance
   * (`.describe()` writes into a global registry). So we narrow to exactly the
   * one property we read, rather than casting to `ZodType` wholesale. */
  const fieldSchema = shape[field] as { description?: string } | undefined;
  const text = fieldSchema?.description;
  return text !== undefined && text.length > 0 ? text : null;
}

/**
 * Degree 1 (spec §5.3), CONTINUED: the parameters of every CONFIGURED family
 * against the `inputSchema` of the tool it routes to. A family in the
 * `notApplicable` state is not reconciled — there will be no pass, nothing to check.
 *
 * WHY THIS IS A SEPARATE FUNCTION, NOT A BRANCH OF `validateConfig`. Spec §5.3
 * assigned degree 1 three things: "missing family, UNKNOWN KEY, negative threshold".
 * `auditConfigSchema` sees ONLY the first one (plus an unknown FAMILY name, because
 * `families` is `.strict()`). NOBODY saw the other two: `familySchema` is
 * `z.record(z.string(), z.unknown())`, i.e. "any key with any value". So
 * `"folio": "Колонтитул v1"` (a string instead of `{styleName}`) survived all
 * the way to a LIVE run and produced 0 folios there and 169 phantom chain defects
 * instead of a rejection that costs zero (`docs/measured-facts-cli.md`
 * §4.1). Only the tool's schema knows a family's shape, and `validateConfig`
 * doesn't see tools and shouldn't need to — it stays clean
 * (no import capable of talking to InDesign; the test guards this).
 *
 * THE SOURCE OF TRUTH IS `inputSchema` ITSELF, not a paraphrase of it. A paraphrase
 * would drift: in this project that has already happened with `nearMissPt`/`nearMissThresholdPt`.
 *
 * THE ARGUMENTS RECONCILED ARE AFTER `planPasses`, not the raw config. `plan.ts`
 * renames (`nearMissPt` → `nearMissThresholdPt`), pours in print thresholds
 * (`print.minPpi` → `geometry`, `print.maxTotalInk`/`expectedInks` →
 * `color`) and strips out control keys (`critical`, the `notApplicable`
 * declaration on sub-families). Reconciling the raw config would reject the working
 * `configs/maaam.json` on the very first field — that's why `planPasses` is called
 * HERE, not accepted as an argument: the caller has no way to supply
 * unplanned arguments.
 *
 * THIS LAYER IS STRICTER THAN THE TOOL, AND ON PURPOSE. `z.object(inputSchema)`
 * in the collector (`src/cli/collect.ts`) is NOT `.strict()` — unknown keys there
 * are TRIMMED silently, and that's a deliberate parity with the MCP SDK (R24), not
 * something "to fix". But an edition's config is written by A HUMAN, and for them a
 * silent trim of a typo is worse than a rejection: the family gets measured on
 * something other than what was written, and stays silent about it.
 *
 * A BOUNDARY NAMED OUT LOUD: `.strict()` acts at the TOP level of a family. A typo
 * INSIDE a nested object (`folio: { stylName: … }`) is not caught by strictness but
 * by its neighbor being required (`styleName` missing → `invalid_type`); where the
 * nested field is optional, the typo still gets through. We don't build recursive
 * strictness here: walking zod's internal fields for someone else's object is a
 * second paraphrase of the schema, exactly what R30 warns against.
 *
 * No touch of InDesign at all: `collectTools()` only assembles handlers into a
 * Map, and parsing runs on plain zod. The cost of a rejection here is zero, as
 * §5.3 requires.
 *
 * `safeParseAsync`, not `safeParse` — for the same reason as in
 * `src/cli/collect.ts`: the SDK parses asynchronously, and a synchronous parse of
 * a schema with an asynchronous `refine` would throw a runtime error instead of a
 * verdict. There are zero such `refine`s in `src/tools/` today, but a validator
 * that REJECTS differently from how the tool accepts is a worse flaw than the one
 * it's fixing.
 */
export async function reconcileWithToolSchemas(cfg: AuditConfig, box: ToolBox): Promise<void> {
  for (const pass of planPasses(cfg).passes) {
    if (!FAMILIES.has(pass.id)) continue;
    const entry = box.get(pass.tool);
    if (entry === undefined) {
      throw new ConfigError(
        pass.id,
        null,
        `family is routed to the tool "${pass.tool}"`,
        `Tool "${pass.tool}" isn't among the collected ones — the family isn't measured ` +
          "at all. This is a code defect, not a config one: the route is set by src/cli/run/plan.ts.",
      );
    }
    /*
     * I7 (final review, Important): this used to have an exception for
     * `__cli_extras` — "a synthetic schema entry doesn't and won't have one (R24,
     * requirement 3)". The exception covered exactly TWO families, `extras` and
     * `sequences`, which carry SIX of §10's fourteen control numbers,
     * and a typo in a KEY slipped straight through it: `bodyTextStyle` instead of
     * `bodyTextStyles` wasn't caught here, nor at degree 2 (`collectNames`
     * only looks at keys from `STYLE_KEYS`), nor by the JSX itself
     * (`params.bodyTextStyles ? … : []`) — and the report printed «Примусових
     * розривів: 402, з них в основному тексті 0».
     *
     * A measurement schema now exists (`СХЕМА_CLI_EXTRAS`, `src/cli/measure/extras.ts`,
     * registered in `src/cli/collect.ts`), so no family escapes this reconciliation
     * anymore. The check stays — but now as a guard of BOX SHAPE, not as an
     * exception: an entry without a schema would mean the route leads somewhere
     * this check can't see, and staying silent about that isn't an option.
     */
    if (entry.inputSchema === undefined) {
      throw new ConfigError(
        pass.id,
        null,
        `family is routed to the tool "${pass.tool}", which has NO inputSchema`,
        "there's nothing to check the family's shape against, so a typo in a key would survive " +
          "to the report as a silent zero (that's exactly what happened with extras/sequences before I7). This is a code defect, not a config one: " +
          "the tool must declare its input shape — see СХЕМА_CLI_EXTRAS in " +
          "src/cli/measure/extras.ts as an example for a synthetic entry.",
      );
    }

    const shape = entry.inputSchema;

    /*
     * A SUB-FAMILY DECLARED NOT APPLICABLE (F2, ruling R29) never reaches the
     * tool: `plan.ts` strips it together with `critical`. So `.strict()`
     * below won't see it — and a typo in ITS name ("contnts" instead of
     * "contents") wouldn't disable anything, yet the report would print the
     * reason under a name the tool doesn't have. That's exactly the flaw this
     * whole reconciliation exists to guard against, just turned inside out.
     * That's why the sub-family name is checked against that same `shape` —
     * separately, because by the time we're in the arguments it's already gone.
     */
    const state = cfg.families[pass.id as keyof AuditConfig["families"]];
    if (typeof state === "object" && state !== null) {
      for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
        if (!isNotApplicable(value) || key in shape) continue;
        throw new ConfigError(
          pass.id,
          key,
          `unknown sub-family; tool "${pass.tool}" accepts: ${Object.keys(shape).join(", ")}`,
          "you can only declare not-applicable what the tool ACTUALLY measures: " +
            "otherwise the report would print the reason under a name that doesn't exist, while the real " +
            "sub-family would keep measuring — 'not seen' and 'measured' at the same time.",
        );
      }
    }

    const result = await z.object(shape).strict().safeParseAsync(pass.args);
    if (result.success) continue;

    const issue = result.error.issues[0]!;
    /*
     * zod 4.4.3, MEASURED: `unrecognized_keys` puts the key name in
     * `issue.keys`, and leaves `path` at the level ABOVE (here — empty, because
     * we're parsing the family's arguments themselves). You cannot read the name
     * from `path` — it isn't there. The same trap that already bit us with `families`.
     */
    if (issue.code === "unrecognized_keys") {
      const key = issue.keys[0] ?? null;
      throw new ConfigError(
        pass.id,
        key,
        `unknown family key; tool "${pass.tool}" accepts: ${Object.keys(shape).join(", ")}`,
        `the unrecognized key is dropped SILENTLY by the tool (z.object(inputSchema) in the collector isn't ` +
          `.strict() — a deliberate parity with the MCP SDK), so a typo would cost not ` +
          `an error but an unmeasured family. There's nothing to guess which parameter was ` +
          `meant from: name it yourself.`,
      );
    }

    const path = issue.path.map(String);
    throw new ConfigError(
      pass.id,
      path.join(".") || null,
      describe(shape, path[0]) ?? `tool's parameter "${pass.tool}"`,
      `the shape is set by the tool's OWN schema "${pass.tool}", and the config must ` +
        `repeat it — there's nothing to guess it from: parsing says "${issue.message}". ` +
        `An incorrect shape doesn't give zero findings, it gives an UNMEASURED family: on ` +
        `a live run, "folio" as a string instead of {styleNames} gave 0 folios and 169 ` +
        `phantom chain defects, and not a single error.`,
    );
  }
}

/**
 * Config keys whose values are paragraph/character style names.
 *
 * The list is NOT invented. The source of truth is THE TOOL SCHEMAS THEMSELVES,
 * because it's exactly their shape the config is obligated to mirror:
 *
 *   - `folio` → `{ styleNames }`           — `FOLIO_OBJECT`, `src/tools/pagination.ts`
 *   - `runningHead` → `{ styleNames }`     — `src/tools/pagination.ts`
 *   - `contents` → `{ numberStyle, levelMap: [{ contentsStyle,
 *     headingStyles }] }`                  — `src/tools/pagination.ts:99-125`
 *   - `headingStyles` as a bare array      — `src/tools/pagination.ts:622`
 *   - `sequences.rules[].style`            — spec §5.2
 *   - `extras.bodyTextStyles`              — config example, plan line 2522
 *
 * WHY BOTH OUTER AND INNER NAMES ARE HERE (`folio` alongside `styleNames`).
 * The config shape fix (task A1) moved the style name down one level: it used
 * to be `"folio": "Колонтитул v1"`, and became
 * `"folio": { "styleNames": ["Колонтитул v1"] }` (the singular `styleName`
 * survived until `fc8f96d`, which lifted the "one folio style only" limit).
 * The `folio` key now holds an object, not a string, so without
 * `styleNames`/`contentsStyle` in
 * this list, degree 2 would stop seeing the NAMES — exactly the ones whose
 * wrong values already produced 45 false findings. Proven by a failing
 * test, not by reasoning (`tests/unit/cli-config-reconcile.test.ts`,
 * the "pagination families' real shapes" block).
 *
 * The outer names stay on purpose — but no longer for the reason they were added
 * for. Task F3 fixed the example in spec §5.2, so a config written against the
 * CURRENT spec never has the old shape. They stay for the sake of configs written
 * against the OLD one (they were written from the example, and that's exactly how
 * `configs/maaam.json` came to be): such a config would already fail at degree 1
 * (`reconcileWithToolSchemas` above), but if it were ever to fail somewhere else
 * instead — `folio: "string"` gets an honest degree-2 rejection instead of a
 * silent skip.
 *
 * WHAT NO LONGER BELONGS HERE, AND WHY (handoff §2.5, 2026-08-18). The singular
 * `styleName` and the plural `styles` sat here as GHOSTS: there is NO key with
 * either of those names in any tool schema. `styleName` survived the `fc8f96d`
 * rename, `styles` — who knows what; the guard didn't see them because it only
 * checked one direction ("no live key was dropped"), not the opposite one. A dead
 * entry in the mirror isn't harmless: the mirror is the list of WHAT DEGREE 2
 * RECONCILES AGAINST THE DOCUMENT, and a ghost in it teaches the next reader a
 * shape that no longer exists.
 *
 * They played no protective role — VERIFIED BY EXECUTION, not by reasoning:
 * `folio: { styleName: "…" }` produces the rejection "pagination.folio.styleNames
 * … expected array, received undefined", while `folio: "string"` produces
 * "pagination.folio … expected object, received string". Both at degree 1, both
 * with a named cause. So the old shape never survives to reach degree 2 at all,
 * and there was nothing here for its defense to duplicate.
 *
 * `composition.spacingMode` is an enum value ("style-bounds"), not a style
 * name, so it doesn't belong here.
 *
 * THE GUARD (F4). This list is a MANUAL MIRROR of the schemas, and it has already
 * gone blind twice: `bodyTextStyles` fell out of it (added after review), task A
 * added three more keys (`styleName`, `styleNames`, `contentsStyle`). The cost of
 * blindness is measured: 45 false findings from a nonexistent style that degree 2
 * didn't see. So the set is now EXPORTED and reconciled against the schemas —
 * `tests/unit/cli-config-style-keys.test.ts`. The guard isn't omniscient: "this is
 * a style name" isn't machine-visible from a bare `z.string()`, so the test only
 * REQUIRES that EVERY schema key be named in one of two explicit lists — "style
 * name" or "deliberately not". A new key in any `inputSchema` fails until a human
 * says which camp it belongs to.
 */
export const STYLE_KEYS = new Set([
  "folio",
  "runningHead",
  "headingStyles",
  "numberStyle",
  "styleNames",
  "contentsStyle",
  "style",
  "bodyTextStyles",
]);

function collectNames(node: unknown, collected: string[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectNames(v, collected);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (STYLE_KEYS.has(k)) {
      if (typeof v === "string") collected.push(v);
      else if (Array.isArray(v)) for (const s of v) if (typeof s === "string") collected.push(s);
    }
    collectNames(v, collected);
  }
}

/** The closest existing name — so the rejection can be fixed without guessing. */
function closestMatch(wanted: string, available: readonly string[]): string | null {
  const wantedLower = wanted.toLowerCase();
  let best: string | null = null;
  let score = 0;
  for (const candidate of available) {
    let shared = 0;
    const candidateLower = candidate.toLowerCase();
    while (shared < wantedLower.length && shared < candidateLower.length && wantedLower[shared] === candidateLower[shared]) shared++;
    if (shared > score) {
      score = shared;
      best = candidate;
    }
  }
  return score >= 3 ? best : null;
}

/**
 * Degree 2 (spec §5.3): a named style that doesn't exist in the document is a
 * REJECTION, not a zero-finding result.
 *
 * The basis is direct: in the 2026-08-16 session, wrong `headingStyles` produced
 * 45 false findings; the correct value was `["Назва розділу"]`. Zero findings
 * from a nonexistent style is indistinguishable from a clean layout.
 *
 * Runs AFTER opening the document, but BEFORE the heavy passes: the cost is
 * one open, not ten minutes.
 *
 * `docName` (task G) is the name of the document `styleNames` was TAKEN FROM,
 * and it's mandatory, not decorative. The list of styles comes from
 * `doc_overview`, i.e. from `app.activeDocument`; the rejection is only true
 * about that document. The 2026-08-16 live run said "the document has no style
 * „Колонтитул v1“", having queried the cover, while the target book carried
 * that style in 99 paragraphs — and the message sent the reader off looking for
 * a typo in the config that wasn't there. The same class of problem as R27:
 * naming a cause that wasn't the real one is worse than naming none.
 */
export function reconcileWithDocument(
  cfg: AuditConfig,
  styleNames: readonly string[],
  docName: string,
): void {
  for (const family of FAMILY_NAMES) {
    const state = cfg.families[family];
    if (isNotApplicable(state)) continue;
    const named: string[] = [];
    collectNames(state, named);
    for (const name of named) {
      if (styleNames.includes(name)) continue;
      const closest = closestMatch(name, styleNames);
      throw new ConfigError(
        family,
        name,
        "a style name from this document",
        `In document "${docName}" the style "${name}" doesn't exist.` +
          (closest !== null ? ` The closest existing one is "${closest}".` : "") +
          " Zero findings from a nonexistent style are indistinguishable from a clean" +
          " layout: incorrect headingStyles have already produced 45 false findings.",
      );
    }
  }
}
