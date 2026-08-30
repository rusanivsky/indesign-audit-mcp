import type { Aff, AffixGroup, AffixRule, FlagMode } from "./types.js";

/**
 * Directives that stay deliberately UNIMPLEMENTED (none of the three books
 * measured on 2026-08-13 — uk_UA, en_US, en_GB — uses them) and that WOULD
 * CHANGE the verdict if they appeared. Silently ignoring them would produce a
 * quiet bug on a different language — spec §7 requires a loud refusal. FLAG,
 * AF and AM are removed from here: the first two are implemented below, the
 * third changes nothing for the check (see IGNORED) and has been moved there.
 * COMPOUND* directives are also removed — they're recognized separately
 * (isCompoundDirective) as "present but not applied".
 */
const UNSUPPORTED = [
  "COMPOUNDBEGIN", "COMPOUNDEND", "COMPOUNDMIDDLE", "NEEDAFFIX", "CIRCUMFIX",
  "FORBIDDENWORD", "COMPLEXPREFIXES",
];

/**
 * Directives that change nothing for the "known / unknown" verdict — needed
 * only for suggestions (phonetic, case-related, etc.), which this phase
 * doesn't offer.
 */
const IGNORED = [
  "SET", "TRY", "REP", "MAP", "KEY", "NAME", "HOME", "VERSION", "LANG",
  "NOSUGGEST", "AM", "PHONE", "OCONV",
];

/**
 * Compound-word directives: recognized (so as not to throw on English
 * dictionaries, where they're always present), but NOT applied — the
 * expander doesn't know how to compose words from parts. This is a
 * deliberate boundary of the phase, not a forgotten case: compound forms
 * like "1st" get reported further downstream as unknown words, and that's
 * written into the tool's response, not hidden silently.
 */
function isCompoundDirective(key: string): boolean {
  return (
    key === "COMPOUNDRULE" ||
    key === "COMPOUNDMIN" ||
    key === "COMPOUNDFLAG" ||
    key === "ONLYINCOMPOUND" ||
    key.startsWith("CHECKCOMPOUND")
  );
}

function toCondition(raw: string, isSuffix: boolean): RegExp {
  /* "." means "anything" — there is no condition. */
  if (raw === ".") return /^/;
  /* A hunspell condition is a sequence of letters and [..] classes; it anchors
   * to the end of the stem for SFX and to the start for PFX. */
  return new RegExp(isSuffix ? `${raw}$` : `^${raw}`, "u");
}

/**
 * FLAG is read in a SEPARATE, first pass over the text — it determines how
 * flag text is parsed in ALL subsequent lines (SFX, PFX, AF). A single-pass
 * parse that encountered SFX before FLAG would parse everything above the
 * FLAG line incorrectly.
 */
function detectFlagMode(text: string): FlagMode {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const parts = t.split(/\s+/);
    if (parts[0] !== "FLAG") continue;
    const mode = parts[1];
    if (mode === "long") return "long";
    if (mode === "num") return "num";
    /* A missing directive and the value "UTF-8" are the same thing: one Unicode
     * character = one flag. */
    return "single";
  }
  return "single";
}

/** Parses a flag specification according to FLAG mode, WITHOUT consulting the
 * AF alias table — the AF table itself is built from lines of this exact
 * format, so it has nothing to consult in itself while it's being built. */
function splitFlags(spec: string, flagMode: FlagMode): string[] {
  if (flagMode === "num") {
    if (spec === "") return [];
    const parts = spec.split(",");
    /* Loud failure on "12,,34" and "12,ab": in num mode a flag is a number, and
     * silently accepting an empty or letter token would produce a flag that
     * matches no group header, i.e. a SILENTLY lost paradigm. Measured before
     * adding this (2026-08-14): across 35,822 en_GB entries with flags — not a
     * single comma and not a single non-numeric value, so the check cannot
     * misfire on real dictionaries. */
    for (const p of parts) {
      if (!/^\d+$/.test(p)) {
        throw new Error(
          `Flag "${spec}" in FLAG num mode contains a non-numeric element "${p}». ` +
            `The verdict would be silently wrong, so parsing is halted.`,
        );
      }
    }
    return parts;
  }
  if (flagMode === "long") {
    /* Loud failure on an odd tail: in long mode a flag is EXACTLY two letters,
     * and silently dropping the odd half would produce the same silent failure
     * as above. None of the three measured dictionaries use long, so the cost
     * of the check today is zero — but without it, degradation on a fourth
     * dictionary would be invisible. */
    if (spec.length % 2 !== 0) {
      throw new Error(
        `Flag "${spec}" in FLAG long mode has odd length ${spec.length}: ` +
          `in this mode a flag is exactly two letters. Parsing halted.`,
      );
    }
    const out: string[] = [];
    for (let i = 0; i < spec.length; i += 2) out.push(spec.slice(i, i + 2));
    return out;
  }
  return spec.split("");
}

/**
 * Parses a flag specification the way it occurs in a .dic file (e.g. the tail
 * after "/" in "cat/SM") or in the .aff itself. The riskiest branch here is
 * the ALIAS case: if the AF table isn't empty and `spec` is an integer within
 * its range, it is NOT the flag "1", but the AF row NUMBER — hunspell numbers
 * aliases starting from one. A parser that doesn't know this doesn't crash —
 * it silently picks up someone else's flags.
 */
export function parseFlags(spec: string, aff: Aff): string[] {
  if (aff.aliases.length > 0 && /^\d+$/.test(spec)) {
    const idx = Number(spec);
    if (idx >= 1 && idx < aff.aliases.length) return aff.aliases[idx]!;
  }
  return splitFlags(spec, aff.flagMode);
}

export function parseAff(text: string): Aff {
  const flagMode = detectFlagMode(text);
  const sfx = new Map<string, AffixGroup>();
  const pfx = new Map<string, AffixGroup>();
  const ignore: string[] = [];
  let wordChars: string[] = [];
  const breaks: string[] = [];
  let breaksExpected = 0;
  const aliases: string[][] = [];
  let aliasesExpected = 0;
  const iconv: Array<[string, string]> = [];
  let iconvExpected = 0;
  let compoundPresent = false;

  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const parts = t.split(/\s+/);
    const key = parts[0]!;

    if (key === "FLAG") continue; // already read by the first pass (detectFlagMode)

    if (isCompoundDirective(key)) { compoundPresent = true; continue; }

    if (UNSUPPORTED.includes(key)) {
      throw new Error(
        `Directive "${key}" in .aff is not supported by the expander. The verdict would be ` +
          `silently wrong, so parsing is halted. Implement it or narrow the language.`,
      );
    }
    if (IGNORED.includes(key)) continue;

    if (key === "IGNORE") { ignore.push(...(parts[1] ?? "").split("")); continue; }
    if (key === "WORDCHARS") { wordChars = (parts[1] ?? "").split(""); continue; }
    if (key === "BREAK") {
      /* The first BREAK is a counter, the rest are the patterns themselves. */
      if (breaksExpected === 0 && /^\d+$/.test(parts[1] ?? "")) {
        breaksExpected = Number(parts[1]);
      } else {
        const pattern = parts[1] ?? "";
        /* Anchored patterns (`^-`, `-$`) are understood by hunspell as "a hyphen is
         * allowed at the start/end", while dic.ts treats BREAK as a LITERAL
         * separator (`w.split(br)`). For `^-` this isn't a verdict error but
         * silent INACTION: `w.includes("^-")` never holds, so the rule simply
         * doesn't work and says nothing about it. This is exactly the kind of
         * silent degradation this whole file guards against with loud
         * failures. Measured: none of the three dictionaries has anchored
         * patterns (uk_UA «-»; en_GB «—», «–», «-»; en_US doesn't declare
         * BREAK), so the check doesn't fire today. */
        if (pattern.startsWith("^") || pattern.endsWith("$")) {
          throw new Error(
            `BREAK pattern "${pattern}" is anchored to a word edge, but the expander ` +
              `treats BREAK as a literal separator — the rule would silently ` +
              `not fire. Implement anchoring or narrow the language.`,
          );
        }
        breaks.push(pattern);
      }
      continue;
    }
    if (key === "AF") {
      /* The first AF is a row counter for the table, just like BREAK above. The
       * header also immediately sets up aliases[0] — an unused slot that keeps
       * the indexing 1-based without a manual offset on every access. */
      if (aliasesExpected === 0 && aliases.length === 0 && /^\d+$/.test(parts[1] ?? "")) {
        aliasesExpected = Number(parts[1]);
        aliases.push([]);
      } else {
        aliases.push(splitFlags(parts[1] ?? "", flagMode));
      }
      continue;
    }
    if (key === "ICONV") {
      /* The same counter-then-rows shape as AF/BREAK, but without a slot 0:
       * ICONV is an ordered list of pairs, not a numbered table. */
      if (iconvExpected === 0 && iconv.length === 0 && /^\d+$/.test(parts[1] ?? "")) {
        iconvExpected = Number(parts[1]);
      } else {
        iconv.push([parts[1] ?? "", parts[2] ?? ""]);
      }
      continue;
    }

    if (key !== "SFX" && key !== "PFX") {
      throw new Error(
        `Directive "${key}" in .aff is unknown to the parser. Silently ignoring it ` +
          `would give a silent bug on another dictionary, so parsing is halted. Add ` +
          `support or narrow the language.`,
      );
    }

    const isSuffix = key === "SFX";
    const target = isSuffix ? sfx : pfx;
    const flag = parts[1]!;

    /* Group header: SFX flag Y|N count */
    if (parts.length === 4 && (parts[2] === "Y" || parts[2] === "N")) {
      target.set(flag, { flag, crossProduct: parts[2] === "Y", rules: [] });
      continue;
    }

    /* Rule: SFX flag strip add condition */
    const group = target.get(flag);
    if (!group) throw new Error(`Rule ${key} ${flag} appears before its group's header.`);
    const rule: AffixRule = {
      strip: parts[2] === "0" ? "" : (parts[2] ?? ""),
      /* The tail after "/" — flags that the affix itself grants; not needed for
       * the check, because we're going in the reverse direction. */
      add: (parts[3] === "0" ? "" : (parts[3] ?? "")).split("/")[0]!,
      condition: toCondition(parts[4] ?? ".", isSuffix),
    };
    group.rules.push(rule);
  }

  return { sfx, pfx, ignore, wordChars, breaks, flagMode, aliases, iconv, compoundPresent };
}
