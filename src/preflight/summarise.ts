/**
 * Converting the raw `aggregatedResults` into a report. Pure TypeScript — that's
 * exactly why it's testable without InDesign.
 */

import {
  MAX_PREFLIGHT_OCCURRENCES,
  type PreflightFinding,
  type PreflightMeasure,
  type PreflightOccurrence,
  type PreflightReport,
  type PreflightRow,
} from "./types.js";

/**
 * The rule whose being disabled costs the most: "low image resolution".
 * Named in the caveat ONLY when it is actually among the disabled ones.
 */
export const IMAGE_RESOLUTION_RULE = "ADBE_ImageResolution";

/** The flag that disables the rule entirely. Every other value means "working". */
export const DISABLED_FLAG = "RULE_IS_DISABLED";

/**
 * InDesign appends a count in parentheses to the label: "Overset text (1)".
 * The report needs just the name — we already know the count from the list
 * of occurrences, and two sources for the same number will eventually diverge.
 */
export function stripCount(label: string): string {
  /*
   * Only DIGITS in parentheses. `\(.+\)` instead of `\(\d+\)` looks innocent but
   * silently eats the name: "Missing font (Minion Pro)" would turn into "Missing
   * font", losing the exact word someone would search for the font by.
   */
  return label.replace(/\s*\(\d+\)\s*$/, "");
}

/**
 * The measured shape of the description is "key: value" pairs joined by `\n`:
 * `"Problem: Overset text: 94 characters\nFix: Resize the text frame…"`.
 * When the description reconstructs from the pairs EXACTLY, it isn't duplicated
 * in the response.
 */
function describesNothingNew(
  description: string,
  details: PreflightOccurrence["details"],
): boolean {
  if (details.length === 0) return false;
  return details.map((d) => `${d.key}: ${d.value}`).join("\n") === description;
}

/**
 * Rebuilds a tree from a flat list.
 *
 * Levels: 1 — category, 2 — rule, 3 — a specific occurrence. A level-3 line
 * without preceding levels 1 and 2 makes no sense, so it falls into the
 * "(unknown)" category/rule instead of being dropped: silently losing a line
 * would be exactly the failure mode this tool was written against.
 */
export function buildFindings(rows: PreflightRow[]): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  let category = "(unknown)";
  let current: PreflightFinding | null = null;

  for (const row of rows) {
    const [depth, label, page, description, pairs] = row;

    if (depth === 1) {
      category = stripCount(label);
      /*
       * The reset is MANDATORY. Without it, the very first occurrence under a NEW
       * category would silently get attributed to the rule from the PREVIOUS one —
       * the report would stay plausible and be wrong.
       */
      current = null;
      continue;
    }

    if (depth === 2) {
      current = { category, rule: stripCount(label), occurrenceCount: 0, occurrences: [] };
      findings.push(current);
      continue;
    }

    /* depth 3 and deeper — an occurrence. */
    if (current === null) {
      current = { category, rule: "(unknown)", occurrenceCount: 0, occurrences: [] };
      findings.push(current);
    }

    const details = pairs.map(([key, value]) => ({ key, value }));
    const occ: PreflightOccurrence = {
      /* An empty string means "there is no page", not a page named "". */
      page: page === "" ? null : page,
      object: label,
      description: description === "" || describesNothingNew(description, details) ? null : description,
      details,
    };
    current.occurrences.push(occ);
    current.occurrenceCount++;
  }

  /*
   * A rule with zero occurrences stays in the report. InDesign sometimes gives
   * a level 2 without a level 3 (a document-level violation like a missing
   * font), and dropping such a line would mean losing a finding because of its
   * shape.
   */
  return findings;
}

/** Everything the caveat is built from. No number and no name from outside the measurement. */
export interface CaveatInput {
  /** The profile actually used to MEASURE — not one that was measured with at some point in the past. */
  profileName: string;
  enabled: number;
  disabled: number;
  disabledRuleIds: string[];
  /**
   * УВІМКНЕНІ правила — потрібні, щоб відрізнити третій стан від двох
   * очевидних. Правило, якого в профілі НЕМАЄ ЗОВСІМ, не лежить ані тут, ані
   * у `disabledRuleIds`, і доти воно потрапляло в гілку «увімкнено, роздільність
   * перевірено». Тобто відповідь стверджувала про вимір те, чого не міряли.
   */
  enabledRuleIds: string[];
  occurrences: number;
  preflightOff: boolean;
  /**
   * `true` — the COMPLETENESS of the listing is not confirmed, even though a
   * result was read. Not "didn't finish waiting": two states lead here, and the
   * second one (see `waitPolarity`) isn't measured as a timeout at all.
   */
  waitTimedOut: boolean;
  /**
   * Not `null` — `waitForProcess` returned something OTHER than a boolean, and
   * `waitTimedOut` above is forced to `true`. The caveat block is then different:
   * saying "timed out" would claim something the measurement didn't show.
   */
  waitPolarity: string | null;
  shapeRecognised: boolean;
  rowsSeen: number;
  rowsParsed: number;
}

/**
 * The text that saves "0 errors" from being misread.
 *
 * The wording deliberately names NUMBERS, not a judgment: how many rules were
 * active, how many were silent. Judging "is that good or bad" is for the human
 * who knows their own print shop — the tool doesn't know that and doesn't
 * pretend to.
 *
 * EVERY CLAIM HERE IS DERIVED FROM THIS SAME MEASUREMENT. The first draft baked
 * the sentence "in profile [Basic] ADBE_ImageResolution is disabled by default"
 * into every response — regardless of which profile was actually used to
 * measure or what was actually disabled in it. That made the caveat's own
 * advice untrue: an operator would enable the rule in their own profile,
 * measure with it — and read that resolution hadn't been checked.
 */
export function buildCaveat(input: CaveatInput): string {
  const total = input.enabled + input.disabled;
  const parts: string[] = [];

  /*
   * THE STRONGEST SIGNAL COMES FIRST, and this is it: the listing is INCOMPLETE.
   * The other blocks say what wasn't asked; this one says the answer wasn't
   * heard out to the end.
   */
  /* `typeof`, not `!== null`: a field that never arrived at all is `undefined`,
   * and that would trigger this block on EVERY successful run. */
  if (typeof input.waitPolarity === "string") {
    /*
     * A separate wording, not the same one: the polarity of `waitForProcess` was
     * measured against `true`/`false`, and a value outside that pair gives no
     * grounds to say "timed out". Only the conclusion about COMPLETENESS stays
     * unchanged — we treat that conservatively, i.e. as unconfirmed.
     */
    parts.push(
      `WARNING: waitForProcess returned a NON-boolean value (${input.waitPolarity}), ` +
        "and this call's polarity is measured specifically as true/false. Whether preflight " +
        "finished — is UNKNOWN, so the list is considered INCOMPLETE (waitTimedOut = true " +
        "was set conservatively, not measured). The findings below are genuine individually: " +
        "they were read from the result, not from this value.",
    );
  } else if (input.waitTimedOut) {
    parts.push(
      "WARNING: preflight did NOT finish (waitTimedOut = true), and the result " +
        "was read partially. The findings below are genuine individually, but the list is INCOMPLETE — " +
        "there may be more. Give it a longer timeout and try again before drawing conclusions.",
    );
  }

  /*
   * Next in strength: a disabled live preflight means the numbers below are
   * from a one-off run, while the InDesign panel stays silent permanently.
   */
  if (input.preflightOff) {
    parts.push(
      "WARNING: the live preflight in the document is DISABLED (preflightOff = true). " +
        "These numbers are from a one-off run on demand; InDesign itself stays silent about these " +
        "same violations until the flag is turned back on.",
    );
  }

  /* A shape the parser didn't recognize is not "zero violations". */
  if (!input.shapeRecognised) {
    parts.push(
      "WARNING: InDesign returned the result in a shape the parser didn't recognize " +
        "(shapeRecognised = false). Zero findings here means \"couldn't read it\", " +
        "not \"no violations\".",
    );
  } else if (input.rowsParsed < input.rowsSeen) {
    parts.push(
      `WARNING: out of ${input.rowsSeen} result rows, ${input.rowsParsed} were parsed. ` +
        "Unparsed rows did NOT make it into findings — there may be more findings than shown.",
    );
  }

  parts.push(
    input.occurrences === 0
      ? "No violations found — but that means \"zero under the enabled rules\", not \"the layout is clean\"."
      : `Found ${input.occurrences} violations under the enabled rules.`,
  );

  parts.push(
    `In profile "${input.profileName}" ${input.enabled} rules are active out of ${total}; ` +
      `${input.disabled} disabled and never checked at all. The list of disabled ones is in disabledRuleIds.`,
  );

  /*
   * The rule can be named explicitly ONLY when it's actually disabled in this
   * measurement. Otherwise — say the opposite, also from the measurement.
   */
  /*
   * ТРИ СТАНИ, А НЕ ДВА — і третій до 2026-08-26 видавав себе за «увімкнено».
   *
   * Правило буває вимкненим, увімкненим, і ВІДСУТНІМ У ПРОФІЛІ ЗОВСІМ. Третій
   * стан не потрапляє в жоден із двох списків, а перевірялося тільки членство
   * в `disabledRuleIds` — тож будь-який власний профіль, зібраний із кількох
   * потрібних правил (а саме це радить остання фраза цього ж застереження),
   * діставав рядок «ADBE_ImageResolution … ENABLED — resolution was checked».
   * Роздільності при цьому не перевіряв ніхто.
   *
   * Це рівно та підміна, проти якої написано весь файл: нуль, що не
   * відрізняється від «не питали».
   */
  if (input.disabledRuleIds.indexOf(IMAGE_RESOLUTION_RULE) !== -1) {
    parts.push(
      `Among the disabled ones — ${IMAGE_RESOLUTION_RULE} (low image resolution): ` +
        "so zero resolution errors says nothing about resolution.",
    );
  } else if (input.enabledRuleIds.indexOf(IMAGE_RESOLUTION_RULE) !== -1) {
    parts.push(
      `${IMAGE_RESOLUTION_RULE} (low image resolution) is ENABLED in this profile — ` +
        "resolution was checked; the threshold came from the profile, the tool doesn't set it.",
    );
  } else {
    parts.push(
      `${IMAGE_RESOLUTION_RULE} (low image resolution) is NOT PRESENT in profile ` +
        `"${input.profileName}" at all — neither enabled nor disabled. Resolution was ` +
        "therefore NOT checked, and zero resolution errors says nothing about it. This is " +
        "not the same as the rule being switched off: a profile assembled from a few chosen " +
        "rules simply does not carry it.",
    );
  }

  parts.push(
    "To check more, enable the needed rules in the profile using InDesign itself — " +
      "the tool doesn't modify profiles.",
  );

  return parts.join(" ");
}

/**
 * Truncates the list of occurrences with a SHARED budget across the whole
 * response.
 *
 * The budget is shared, not per rule: 200 occurrences cost the same 84 KB
 * whether they're spread across one rule or across twenty. Each rule's
 * `occurrenceCount` stays TRUE — so the truncation is visible in the structure
 * itself, not only in a field next to it.
 */
function capOccurrences(findings: PreflightFinding[]): PreflightFinding[] {
  let budget = MAX_PREFLIGHT_OCCURRENCES;
  return findings.map((f) => {
    const shown = f.occurrences.slice(0, Math.max(0, budget));
    budget -= shown.length;
    return { ...f, occurrences: shown };
  });
}

export function buildReport(measure: PreflightMeasure): PreflightReport {
  const enabled = measure.rules.filter((r) => r.enabled);
  const disabled = measure.rules.filter((r) => !r.enabled);
  const full = buildFindings(measure.rows);
  const occurrenceCount = full.reduce((n, f) => n + f.occurrenceCount, 0);
  const findings = capOccurrences(full);
  const shown = findings.reduce((n, f) => n + f.occurrences.length, 0);
  const disabledRuleIds = disabled.map((r) => r.id);

  return {
    docName: measure.docName,
    profileName: measure.profileName,
    workingProfile: measure.workingProfile,
    preflightOff: measure.preflightOff,
    scope: measure.scope,
    availableProfiles: measure.availableProfiles,
    rulesEnabled: enabled.length,
    rulesDisabled: disabled.length,
    enabledRuleIds: enabled.map((r) => r.id),
    disabledRuleIds,
    findings,
    occurrenceCount,
    occurrencesTruncated: shown < occurrenceCount ? { shown, total: occurrenceCount } : null,
    shapeRecognised: measure.shapeRecognised,
    rowsSeen: measure.rowsSeen,
    rowsParsed: measure.rowsParsed,
    pairsSeen: measure.pairsSeen,
    pairsParsed: measure.pairsParsed,
    processRemoved: measure.processRemoved,
    waitTimedOut: measure.waitTimedOut,
    waitPolarity: measure.waitPolarity,
    caveat: buildCaveat({
      profileName: measure.profileName,
      enabled: enabled.length,
      disabled: disabled.length,
      disabledRuleIds,
      enabledRuleIds: enabled.map((r) => r.id),
      occurrences: occurrenceCount,
      preflightOff: measure.preflightOff,
      waitTimedOut: measure.waitTimedOut,
      waitPolarity: measure.waitPolarity,
      shapeRecognised: measure.shapeRecognised,
      rowsSeen: measure.rowsSeen,
      rowsParsed: measure.rowsParsed,
    }),
  };
}
