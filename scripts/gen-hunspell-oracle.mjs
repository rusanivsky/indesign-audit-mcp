#!/usr/bin/env node
/**
 * Generator for the hunspell oracle.
 *
 * There's nothing inside InDesign to check the TypeScript affix
 * expansion (Phase 9, Task 4) against — `app.checkSpelling`/
 * `findSpelling`/`spellCheck` throw (measured). This script runs the
 * REAL `hunspell` once on the development machine against the same
 * dictionaries Adobe InDesign ships, and records its verdict in
 * `tests/fixtures/hunspell-oracle.json` — tests check against this file
 * offline, without `hunspell` in CI.
 *
 * `hunspell` is NOT added to package.json — it's a one-off external
 * tool, not a build dependency.
 *
 * Usage:
 *   node scripts/gen-hunspell-oracle.mjs <dictionary folders root>
 *
 * where <root> contains subfolders uk_UA/, en_US/, en_GB/, each with
 * its own .dic and .aff (the extensionless path is passed to
 * hunspell -d).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DICT_ROOT = process.argv[2];
if (!DICT_ROOT) {
  console.error(
    "Вжиток: node scripts/gen-hunspell-oracle.mjs <корінь тек словників (uk_UA/, en_US/, en_GB/)>",
  );
  process.exit(1);
}

const LANGS = ["uk_UA", "en_US", "en_GB"];
const MIN_PER_BUCKET = 50;
/** A letter that never occurs in any of the three languages — guarantees "not recognized". */
const IMPLAUSIBLE_LETTER = "ъ";

/* ------------------------------------------------------------------ */
/* Parsing .aff: flag type, the AF table (aliases), SFX/PFX rules.     */
/* ------------------------------------------------------------------ */

function parseAff(affPath) {
  const lines = readFileSync(affPath, "utf8").split("\n");

  let flagType = "char"; // "char" (default, one UTF-8 character at a time) | "num" | "long"
  const af = []; // af[i-1] = array of flag strings for index i
  const sfxByFlag = new Map();
  const pfxByFlag = new Map();

  let afSeenHeader = false;
  let pendingKind = null; // "sfx" | "pfx" — the type of block currently being filled
  let pendingFlag = null;
  let pendingRemaining = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);

    if (tokens[0] === "FLAG") {
      flagType = tokens[1] === "num" ? "num" : tokens[1] === "long" ? "long" : "char";
      continue;
    }

    if (tokens[0] === "AF") {
      if (!afSeenHeader) {
        // The first AF line is just the table's count, not an entry.
        afSeenHeader = true;
        continue;
      }
      af.push(tokens[1].split(","));
      continue;
    }

    if (tokens[0] === "SFX" || tokens[0] === "PFX") {
      const kind = tokens[0] === "SFX" ? "sfx" : "pfx";
      if (pendingRemaining === 0) {
        // Block header line: SFX/PFX <flag> <Y|N> <count>
        pendingKind = kind;
        pendingFlag = tokens[1];
        pendingRemaining = parseInt(tokens[3], 10) || 0;
        const map = kind === "sfx" ? sfxByFlag : pfxByFlag;
        if (!map.has(pendingFlag)) map.set(pendingFlag, []);
        if (pendingRemaining === 0) {
          pendingKind = null;
          pendingFlag = null;
        }
        continue;
      }
      // Rule line: SFX/PFX <flag> <strip> <add[/flags]> <condition> [morph fields]
      const strip = tokens[1];
      const add = tokens[2].split("/")[0];
      const condition = tokens[3];
      const map = pendingKind === "sfx" ? sfxByFlag : pfxByFlag;
      map.get(pendingFlag).push({ strip, add, condition });
      pendingRemaining -= 1;
      if (pendingRemaining <= 0) {
        pendingKind = null;
        pendingFlag = null;
        pendingRemaining = 0;
      }
      continue;
    }
  }

  return { flagType, af, sfxByFlag, pfxByFlag };
}

/** Splits the flag field from a .dic line (e.g. "efg", "3,5,6,7", "4") into an array of flag tokens. */
function resolveFlags(flagsStr, aff) {
  if (!flagsStr) return [];
  if (aff.flagType === "num") {
    if (aff.af.length > 0 && !flagsStr.includes(",")) {
      const idx = parseInt(flagsStr, 10);
      const resolved = aff.af[idx - 1];
      if (resolved) return resolved;
    }
    return flagsStr.split(",");
  }
  if (aff.flagType === "long") {
    const out = [];
    for (let i = 0; i < flagsStr.length; i += 2) out.push(flagsStr.slice(i, i + 2));
    return out;
  }
  // "char" — the default type: every UTF-8 code point is its own flag.
  return Array.from(flagsStr);
}

/** Applies a single SFX/PFX rule to a stem; returns a string, or null if the condition/strip didn't match. */
function applyRule(stem, rule, kind) {
  try {
    if (kind === "sfx") {
      if (rule.strip !== "0" && !stem.endsWith(rule.strip)) return null;
      if (rule.condition !== ".") {
        const re = new RegExp(`${rule.condition}$`, "u");
        if (!re.test(stem)) return null;
      }
      const base = rule.strip === "0" ? stem : stem.slice(0, stem.length - rule.strip.length);
      return base + (rule.add === "0" ? "" : rule.add);
    }
    if (rule.strip !== "0" && !stem.startsWith(rule.strip)) return null;
    if (rule.condition !== ".") {
      const re = new RegExp(`^${rule.condition}`, "u");
      if (!re.test(stem)) return null;
    }
    const base = rule.strip === "0" ? stem : stem.slice(rule.strip.length);
    return (rule.add === "0" ? "" : rule.add) + base;
  } catch {
    // The condition from .aff isn't a valid regex fragment — skip the rule.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Parsing .dic: an array of { stem, flags }.                          */
/* ------------------------------------------------------------------ */

function parseDic(dicPath, aff) {
  const raw = readFileSync(dicPath, "utf8").split("\n").slice(1); // the first line is the count
  const entries = [];
  for (const line of raw) {
    if (!line) continue;
    const mainToken = line.split(/\s/)[0]; // discard morphological fields after a space/tab
    if (!mainToken) continue;
    const slash = mainToken.indexOf("/");
    const stem = slash === -1 ? mainToken : mainToken.slice(0, slash);
    const flagsStr = slash === -1 ? "" : mainToken.slice(slash + 1);
    if (!stem) continue;
    entries.push({ stem, flags: resolveFlags(flagsStr, aff) });
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Building the sample for a single language.                          */
/* ------------------------------------------------------------------ */

function buildSample(lang, dictRoot) {
  const dir = `${dictRoot}/${lang}`;
  const aff = parseAff(`${dir}/${lang}.aff`);
  const entries = parseDic(`${dir}/${lang}.dic`, aff);

  const sample = [];

  /* 1. Stems without affixes (every Nth line of .dic) — catches .dic parsing bugs. */
  const bareStep = Math.max(1, Math.floor(entries.length / 800));
  for (let i = 0; i < entries.length; i += bareStep) sample.push(entries[i].stem);

  /* 2. Real word forms — catches affix-expansion bugs.
   *
   *    DERIVED FROM THE DICTIONARY, FOR EVERY LANGUAGE ALIKE. Until
   *    2026-08-26 Ukrainian took its sample from `book-words.json` — the
   *    word types of one real client book. That made the repository's
   *    strongest test depend on a private manuscript's vocabulary, which
   *    could not be published, and it also made the Ukrainian arm of the
   *    oracle differ in kind from the English one for no methodological
   *    reason.
   *
   *    Deriving the forms mechanically is the better oracle anyway: we take
   *    stems that carry affix flags and apply their OWN SFX/PFX rules, so
   *    the sample cannot diverge from what the dictionary actually
   *    contains, and it covers the affix machinery evenly instead of
   *    however one book happened to inflect. */
  {
    const withFlags = entries.filter((e) => e.flags.length > 0);
    const inflectStep = Math.max(1, Math.floor(withFlags.length / 3000));
    for (let i = 0; i < withFlags.length; i += inflectStep) {
      const { stem, flags } = withFlags[i];
      for (const flag of flags.slice(0, 3)) {
        const sfxRules = aff.sfxByFlag.get(flag);
        const pfxRules = aff.pfxByFlag.get(flag);
        if (sfxRules) {
          for (const rule of sfxRules) {
            const form = applyRule(stem, rule, "sfx");
            if (form) {
              sample.push(form);
              break; // one form per flag is enough for the sample
            }
          }
        }
        if (pfxRules) {
          for (const rule of pfxRules) {
            const form = applyRule(stem, rule, "pfx");
            if (form) {
              sample.push(form);
              break;
            }
          }
        }
      }
    }
  }

  /* 3. Deliberately corrupted forms — catch FALSE LENIENCY
   *    (the most dangerous kind: an expander that says "known" for
   *    everything would pass a sample made only of recognized words).
   *    Two mutations: replacing the last letter with one impossible in
   *    any of the three languages, and trimming the last two
   *    characters. */
  const corruptStep = Math.max(1, Math.floor(entries.length / 400));
  for (let i = 0; i < entries.length; i += corruptStep) {
    const stem = entries[i].stem;
    if (stem.length <= 3) continue;
    sample.push(stem.slice(0, -1) + IMPLAUSIBLE_LETTER);
    sample.push(stem.slice(0, -2));
  }

  return [...new Set(sample)].filter((w) => w && w.length > 0);
}

/* ------------------------------------------------------------------ */
/* Running hunspell and comparing.                                     */
/* ------------------------------------------------------------------ */

function judge(lang, dictRoot, words) {
  const dictPath = `${dictRoot}/${lang}/${lang}`;
  const input = words.join("\n");
  const out = execFileSync("hunspell", ["-d", dictPath, "-l"], {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const unknown = new Set(out.split("\n").filter(Boolean));

  if (unknown.size >= words.length) {
    throw new Error(
      `${lang}: hunspell визнав НЕвизнаними усі ${words.length} слів — ` +
        `шлях -d "${dictPath}" схоже хибний, а не сам словник поблажливий.`,
    );
  }

  return words.map((word) => ({ word, known: !unknown.has(word) }));
}

/* ------------------------------------------------------------------ */
/* Main sequence.                                                      */
/* ------------------------------------------------------------------ */

const oracle = {};

for (const lang of LANGS) {
  const words = buildSample(lang, DICT_ROOT);
  const verdicts = judge(lang, DICT_ROOT, words);
  const knownCount = verdicts.filter((v) => v.known).length;
  const unknownCount = verdicts.length - knownCount;

  if (knownCount < MIN_PER_BUCKET || unknownCount < MIN_PER_BUCKET) {
    console.error(
      `${lang}: вибірка однобока — визнано ${knownCount}, невизнано ${unknownCount} ` +
        `(поріг ${MIN_PER_BUCKET} на кожен бік). Оракул лише з одного боку не доводить нічого.`,
    );
    process.exit(1);
  }

  oracle[lang] = verdicts;
  console.log(
    `${lang}: усього ${verdicts.length}, визнано ${knownCount}, невизнано ${unknownCount}`,
  );
}

writeFileSync(
  "tests/fixtures/hunspell-oracle.json",
  JSON.stringify(oracle, null, 1),
);
console.log("записано tests/fixtures/hunspell-oracle.json");
