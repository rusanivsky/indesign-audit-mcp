import { parseFlags } from "./aff.js";
import { normaliseApostrophes } from "./words.js";
import type { Aff, Dictionary } from "./types.js";

/**
 * Checking works by STRIPPING affixes, not by expanding forward: 111,403
 * stems × paradigms would produce millions of word forms in the MCP server
 * process's memory. Real hunspell does the same.
 */
/*
 * The third parameter `extraWords` no longer exists here. It used to accept
 * "allowed words" from spec §4.1 (`app.userDictionaries`) and was NOT passed
 * from anywhere except its own test. Why this is a closed question rather
 * than debt: it was measured (`measured-facts-phase9.md`, Question 3) that
 * all 16 words in the Ukrainian user dictionary are HYPHENATION MARKUP with
 * tildes (`ва~~гіт~~но~~стей`), not spelling exceptions, and none of them
 * would have matched any word in the book's text. A parameter that serves
 * nothing would only promise that the user dictionary is taken into account.
 * Spec §4.1/§5 has been brought into alignment.
 */
export function buildDictionary(dicText: string, aff: Aff): Dictionary {
  /** stem → set of flags */
  const stems = new Map<string, Set<string>>();

  const add = (word: string, flags: string[]): void => {
    const cur = stems.get(word);
    if (cur) { for (const f of flags) cur.add(f); }
    else stems.set(word, new Set(flags));
  };

  const lines = dicText.split("\n");
  /* The first line of .dic is the entry count, not a word. */
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw === "") continue;
    /* Morphological fields (e.g. "ph:...") come after a space/tab — drop
     * everything but the first token. */
    const mainToken = raw.split(/\s/)[0]!;
    const slash = mainToken.indexOf("/");
    if (slash === -1) add(mainToken, []);
    /* The tail after "/" is NOT necessarily one-character-per-flag: in
     * long/num mode, or via the AF table, the same text is read differently.
     * It's the same parseFlags that parses every SFX/PFX rule, not a
     * bespoke line split — otherwise English dictionaries (FLAG long/num,
     * AF) would silently get the wrong flags. */
    else add(mainToken.slice(0, slash), parseFlags(mainToken.slice(slash + 1), aff));
  }

  const stripIgnored = (w: string): string => {
    let out = w;
    for (const ch of aff.ignore) out = out.split(ch).join("");
    return out;
  };

  /**
   * ICONV — an input substitution that the dictionary declares ITSELF, and
   * without it English breaks silently. `en_GB.aff` carries six pairs: the
   * typographic apostrophe and five ligatures (`ﬁ`→`fi`, `ﬂ`→`fl`, `ﬀ`→`ff`,
   * `ﬃ`→`ffi`, `ﬄ`→`ffl`). A ligature character is `\p{L}`, so `splitWords`
   * hands back "ﬁre" as a single token while the dictionary only holds
   * "fire": without this substitution real hunspell says "known" while we'd
   * say "not in the dictionary". The oracle didn't catch this — its 12,808
   * words contain zero ligatures (verified), i.e. a silent error of exactly
   * the class this phase was guarding against.
   *
   * The order is deliberate: AFTER `trimEdges` (which reads WORDCHARS against
   * the original characters) and BEFORE the lookup. The «’→'» pair
   * duplicates `normaliseApostrophes` — that's harmless and is kept on both
   * paths: normalization is also needed for dictionaries that don't declare
   * ICONV (uk_UA).
   */
  const applyIconv = (w: string): string => {
    let out = w;
    for (const [from, to] of aff.iconv) out = out.split(from).join(to);
    return out;
  };

  /**
   * A character belongs to a word if it's a letter, or if this language's
   * dictionary explicitly named it word-forming via WORDCHARS. The
   * difference between languages here isn't accidental: uk_UA keeps the
   * apostrophe and hyphen in WORDCHARS, so "стіл'" goes to the lookup as a
   * WHOLE string and isn't found — correctly. en_US keeps ONLY the
   * typographic apostrophe (’) in WORDCHARS, not the straight one (U+0027);
   * the straight one remains boundary punctuation, like a quote mark around
   * a word, and that's exactly why "we'" (the oracle's truncated form of
   * "we've") is checked as "we" — the same way real hunspell behaves when it
   * reads a line as text rather than as a bare word.
   */
  const isWordChar = (ch: string): boolean =>
    /\p{L}/u.test(ch) || aff.wordChars.includes(ch) || aff.ignore.includes(ch);

  /** Strips everything from the edges of the string that doesn't belong to a
   * word in this language — boundary punctuation such as quote marks around
   * a word. Doesn't touch internal characters (hyphen, apostrophe INSIDE a
   * word). */
  const trimEdges = (w: string): string => {
    let start = 0;
    let end = w.length;
    while (start < end && !isWordChar(w[start]!)) start++;
    while (end > start && !isWordChar(w[end - 1]!)) end--;
    return w.slice(start, end);
  };

  const hasStem = (candidate: string, flag: string | null): boolean => {
    const flags = stems.get(candidate);
    if (!flags) return false;
    return flag === null || flags.has(flag);
  };

  /** Whether the word is recognized without taking BREAK into account. */
  const knownSimple = (word: string): boolean => {
    if (hasStem(word, null)) return true;

    /* Suffixes: word = stem − strip + add. We go backwards. */
    for (const group of aff.sfx.values()) {
      for (const rule of group.rules) {
        if (rule.add !== "" && !word.endsWith(rule.add)) continue;
        const stem = word.slice(0, word.length - rule.add.length) + rule.strip;
        if (stem === "") continue;
        if (!rule.condition.test(stem)) continue;
        if (hasStem(stem, group.flag)) return true;

        /* A prefix on top of a suffix — only for groups with crossProduct. */
        if (!group.crossProduct) continue;
        for (const pg of aff.pfx.values()) {
          if (!pg.crossProduct) continue;
          for (const pr of pg.rules) {
            if (pr.add !== "" && !stem.startsWith(pr.add)) continue;
            const base = pr.strip + stem.slice(pr.add.length);
            if (base === "") continue;
            if (!pr.condition.test(base)) continue;
            if (hasStem(base, pg.flag) && stems.get(base)!.has(group.flag)) return true;
          }
        }
      }
    }

    /* Prefixes themselves. */
    for (const group of aff.pfx.values()) {
      for (const rule of group.rules) {
        if (rule.add !== "" && !word.startsWith(rule.add)) continue;
        const stem = rule.strip + word.slice(rule.add.length);
        if (stem === "") continue;
        if (!rule.condition.test(stem)) continue;
        if (hasStem(stem, group.flag)) return true;
      }
    }

    return false;
  };

  const known = (word: string): boolean => {
    /* Trimming the edges comes FIRST, on the RAW word: WORDCHARS is read
     * against the original characters (the typographic apostrophe for
     * en_US/en_GB isn't the same character as the straight one, which the
     * normalization below hasn't replaced yet). Then THREE substitutions
     * BEFORE the lookup, all for reasons measured on real dictionaries:
     * ICONV (an input substitution declared by the dictionary itself —
     * en_GB ligatures, see applyIconv above), the apostrophe (the dictionary
     * only holds U+0027, the book's text may arrive as U+2019 or another
     * variant), and the stress mark (IGNORE, the stress accent U+0301 —
     * splitWords deliberately leaves it inside the token, so it has to be
     * stripped here). */
    const w = stripIgnored(normaliseApostrophes(applyIconv(trimEdges(word))));
    if (w === "") return true;
    if (knownSimple(w)) return true;
    /* Lowercase: the dictionary keeps proper nouns capitalized, so "Стіл"
     * should be found via "стіл", but not the other way around.
     *
     * The "uk" locale is used here for ALL dictionaries, and that's
     * deliberate, not an inheritance oversight: `toLowerCase()` is
     * locale-independent by spec, and "uk" differs from the neutral case
     * only in exactly what this phase wants. Measured on English
     * dictionaries — 0 discrepancies against the oracle, because Latin
     * script folds the same way under "uk". The dangerous locales here are
     * others — Turkish and Azerbaijani (dotted İ, dotless ı): if this check
     * were done as tr_TR, "uk" would be WRONG. The same choice as in
     * `keyLocale` (unknown.ts), but there the locale is taken from the
     * language code — and that's exactly where this will need to move if a
     * Turkish dictionary shows up in the build. */
    const lower = w.toLocaleLowerCase("uk");
    if (lower !== w && knownSimple(lower)) return true;

    /* BREAK: a compound word is recognized if ALL its parts are recognized. */
    for (const br of aff.breaks) {
      if (br === "" || !w.includes(br)) continue;
      const parts = w.split(br).filter((p) => p !== "");
      if (parts.length > 1 && parts.every((p) => knownSimple(p) || knownSimple(p.toLocaleLowerCase("uk")))) {
        return true;
      }
    }
    return false;
  };

  return { known, stems: stems.size };
}
