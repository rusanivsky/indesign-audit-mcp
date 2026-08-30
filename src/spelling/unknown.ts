/**
 * The `dictionary` family: "not in the dictionary" is a fact about the
 * dictionary, not an error. Proper names, invented words, borrowings, and
 * new norms are legitimately absent — «Ойойой» is exactly such a word,
 * and no dictionary will ever have it. So the unit of the report is the
 * WORD-TYPE, not the occurrence: a 196-page book would give thousands of
 * lines, most of them the same legitimate word over and over. The useful
 * signal is FREQUENCY (`count`): a typo happens once, a deliberate choice —
 * forty times.
 *
 * The other half of the principle: what is NOT measured must not become
 * invisible. A range whose language has no dictionary in this collection is
 * not "clean" — it's `word-not-checked`. Without this, 520 characters of
 * prose with no language at all would silently pass as correct.
 */
import type { ContainerSnapshot } from "../corrections/types.js";
import { dictLangCode } from "./dictpath.js";
import { normaliseApostrophes, splitWords } from "./words.js";
import { comparePageNames, MAX_PAGES_LISTED, pageAt } from "./types.js";
import type { Aff, ContainerLanguage, Dictionary, WordTypeFinding } from "./types.js";

interface Bucket {
  defect: "word-unknown" | "word-not-checked";
  word: string;
  count: number;
  pages: Set<string>;
  language: string;
}

/**
 * A minimal `Aff` for languages that have no dictionary in the collection.
 * Word boundaries are then unknown, and instead of guessing a conservative
 * set is used: hyphen and apostrophe. This is a NAMED limitation — words in
 * such a range get `word-not-checked` regardless, so an error in the
 * trimming doesn't change the verdict, only the count.
 */
export const DEFAULT_WORD_AFF: Aff = {
  sfx: new Map(), pfx: new Map(), ignore: [], wordChars: ["-", "'"], breaks: [],
  flagMode: "single", aliases: [], iconv: [], compoundPresent: false,
};

/**
 * The locale for case-folding the bucket KEY — by the language of the range
 * itself (`uk_UA` → `uk`, `en_US` → `en`…), not by `toLowerCase()`.
 * `toLowerCase()` is locale-independent by specification: in a Turkish or
 * Azerbaijani dictionary the dotted İ and dotless ı would fold incorrectly,
 * and two different words would silently merge into one bucket — exactly
 * the class of failure this whole phase is hunting. Languages with no
 * matching dictionary code (e.g. "[No Language]") fold with the fallback
 * locale "en" — deterministic and safe for case-insensitive scripts
 * (Cyrillic, Latin).
 */
function keyLocale(code: string | null): string {
  return code?.split("_")[0] ?? "en";
}

/**
 * `override` — the same `languageDictionaries` call parameter as `affFor` in
 * language.ts: without it a language outside the built-in table (e.g.
 * Czech) would always get `word-not-checked`, even when the needed
 * dictionary is already loaded into `dicts` under its own code.
 */
export function detectUnknown(
  containers: ContainerSnapshot[],
  langs: ContainerLanguage[],
  affs: Map<string, Aff>,
  dicts: Map<string, Dictionary>,
  override?: Record<string, string | null>,
): WordTypeFinding[] {
  const byId = new Map(langs.map((l) => [l.containerId, l]));
  const buckets = new Map<string, Bucket>();

  for (const c of containers) {
    for (const run of byId.get(c.containerId)?.runs ?? []) {
      const code = dictLangCode(run.language, override);
      const dict = code === null ? undefined : dicts.get(code);
      /* Split the range by the rules of ITS OWN language, not the document's:
       * English WORDCHARS differ from Ukrainian, and splitting an English
       * insertion with Ukrainian boundaries is the same as measuring inches
       * in centimeters. */
      const aff = (code === null ? undefined : affs.get(code)) ?? DEFAULT_WORD_AFF;
      const slice = c.text.slice(run.start, run.end);

      for (const w of splitWords(slice, aff)) {
        const normalised = normaliseApostrophes(w.text);
        if (dict !== undefined && dict.known(normalised)) continue;

        /* The KEY and the VALUE differ in case deliberately, not by oversight.
         * The key is lowercase: «Жабуринка» and «жабуринка» must collapse
         * into one word-type (and the language is part of the key, so the
         * same character string in different languages doesn't merge — its
         * own dictionary, its own verdict). The `word` value, by contrast,
         * keeps the case of the FIRST occurrence: the report is read by a
         * human who will go looking for the word in the book, and
         * «ойойой ×47» instead of «Ойойой», or «київ» instead of
         * «Київ», is misinformation, not a convenience. The very first
         * occurrence, not the most frequent: cheap and deterministic. */
        const key = `${run.language} ${normalised.toLocaleLowerCase(keyLocale(code))}`;
        const page = pageAt(c, run.start + w.start);
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.count++;
          bucket.pages.add(page);
        } else {
          buckets.set(key, {
            defect: dict === undefined ? "word-not-checked" : "word-unknown",
            word: normalised,
            count: 1,
            pages: new Set([page]),
            language: run.language,
          });
        }
      }
    }
  }

  return [...buckets.values()].map((b) => {
    /* The first MAX_PAGES_LISTED pages go into the string, the full count into
     * pageCount: it's exactly the most frequent words that get the longest
     * page lists, and exactly those that were bloating the response
     * (types.ts, the comment at MAX_PAGES_LISTED). Sorting BEFORE
     * truncating — without it, Set insertion order (containers, not pages)
     * would truncate to an arbitrary six instead of the six lowest (Phase 9
     * → language.ts → types.ts, comparePageNames). */
    const pages = [...b.pages].sort(comparePageNames);
    return {
      defect: b.defect,
      word: b.word,
      count: b.count,
      pages: pages.slice(0, MAX_PAGES_LISTED),
      pageCount: pages.length,
      language: b.language,
    };
  });
}
