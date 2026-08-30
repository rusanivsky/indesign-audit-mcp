import { readFileSync } from "node:fs";
import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import type { ContainerSnapshot } from "../corrections/types.js";
import { parseAff } from "../spelling/aff.js";
import { buildDictionary } from "../spelling/dic.js";
import { dictLangCode, dictPathsFor } from "../spelling/dictpath.js";
import { assertLanguageCoverage, readLanguageRuns } from "../spelling/langruns.js";
import { detectLanguage, tallyLanguages } from "../spelling/language.js";
import { detectUnknown } from "../spelling/unknown.js";
import { buildReport } from "../spelling/report.js";
import type {
  Aff,
  ContainerLanguage,
  DictSource,
  Dictionary,
  LanguageFinding,
  LanguageTally,
  WordTypeFinding,
} from "../spelling/types.js";
import { assertExpectedDoc, EXPECTED_DOC_NAME_FIELD, fail, ok, serialise, type Tools } from "./shared.js";

export type Family = "language" | "dictionary";

/** This is what InDesign calls a range that deliberately has no language assigned (types.ts). */
const NO_LANGUAGE = "[No Language]";

/**
 * Loads the dictionary (.aff + .dic) for one language code. `ENOENT` — the
 * file doesn't exist — is a measured state: returns `null`, and the
 * dictionary for that code is legitimately absent from the bundle. Every
 * other error — a corrupted file, access, I/O, and most importantly a BUG in
 * `parseAff`/`buildDictionary` — is thrown WITH CONTEXT rather than swallowed
 * as "no dictionary": otherwise a bug in our own parsing would reach the user
 * as "no dictionary for Czech", even though the file on disk is present and
 * intact.
 *
 * This function is the ONLY source of the answer to "is there a dictionary
 * for this code". There used to be another one, `availableDictCodes`
 * (walking subdirectories on disk) — removed by the branch's final review as
 * having no consumer at all: it asked "does a folder with this name exist",
 * whereas the question here is more precise — "do this exact .dic and .aff
 * actually read". Two paths to the same answer could have diverged.
 */
export function loadDictionarySource(
  code: string,
  src: DictSource,
): {
  dict: Dictionary;
  aff: Aff;
  path: string;
  stems: number;
  vintage: string | null;
  /** Whether THIS dictionary declares compound-word rules (spec §4.1.1, level 2). */
  compoundRulesPresentNotApplied: boolean;
  /** How many affix groups are in THIS dictionary — the "what it was measured with" (spec §5). */
  affixGroups: { sfx: number; pfx: number };
} | null {
  try {
    const dictAff = parseAff(readFileSync(src.affPath, "utf8"));
    const dict = buildDictionary(readFileSync(src.dicPath, "utf8"), dictAff);
    return {
      dict,
      aff: dictAff,
      path: src.dicPath,
      stems: dict.stems,
      vintage: src.vintage,
      /* The caveat travels ALONGSIDE THE DICTIONARY, not as a single line for the
       * whole response (spec §4.1.1). Before the branch's final review,
       * `Aff.compoundPresent` was computed and read by no production line at
       * all: uk_UA has no compound-word rules, en_US and en_GB do — and a
       * shared `caveat` asserted the same thing about all three alike. */
      compoundRulesPresentNotApplied: dictAff.compoundPresent,
      affixGroups: { sfx: dictAff.sfx.size, pfx: dictAff.pfx.size },
    };
  } catch (error) {
    // ENOENT — the file doesn't exist. A measured state: there's no dictionary for this code.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    // Every other error — a corrupted file, access, I/O, a bug in our own parsing —
    // is thrown with the code and path as context, so it doesn't vanish without a trace.
    throw new Error(
      `could not load the dictionary ${code} from ${src.dicPath}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * All the work that does NOT need InDesign. Split out on purpose, because it
 * lets the tool be covered by unit tests without a live application — the
 * same boundary kept by src/typography/ and src/bibliography/.
 *
 * `languageDictionaries` is threaded all the way down to
 * detectLanguage/tallyLanguages/detectUnknown — they call
 * dictLangCode(run.language, override) themselves internally (language.ts,
 * unknown.ts). Without this, a language outside the built-in table in
 * dictpath.ts (e.g. Czech) would not find its dictionary in `dicts` EVEN IF
 * the call up here had already loaded it: dictLangCode without the override
 * would return null for that same language name a second time, inside the
 * detectors.
 *
 * `languages` (the inventory) is always returned, regardless of `family` — a
 * decision recorded in progress.md ("T8 REOPENED"): without it there's no
 * way to understand why a range's words weren't checked (a bilingual
 * edition), and buildReport (report.ts) DELIBERATELY does not carry the
 * inventory — it's this function that adds it here.
 */
export function collectAudit(
  containers: ContainerSnapshot[],
  langs: ContainerLanguage[],
  affs: Map<string, Aff>,
  dicts: Map<string, Dictionary>,
  opts: { family?: Family; languageDictionaries?: Record<string, string | null> },
): {
  language: LanguageFinding[];
  languages: LanguageTally[];
  words: WordTypeFinding[];
} {
  /* The `language` family also needs the per-language word-splitting rules:
   * the weight is counted in WORDS, and each language has its own word
   * boundary. We take the same `affs`. */
  const language: LanguageFinding[] = opts.family === "dictionary"
    ? [] : detectLanguage(containers, langs, affs, opts.languageDictionaries);
  /* The INVENTORY is always returned, even when only `dictionary` was
   * requested: without it there's no way to understand why a range's words
   * weren't checked, and it's exactly what makes the report usable for a
   * bilingual edition. */
  const languages: LanguageTally[] = tallyLanguages(containers, langs, affs, opts.languageDictionaries);
  const words: WordTypeFinding[] = opts.family === "language"
    ? [] : detectUnknown(containers, langs, affs, dicts, opts.languageDictionaries);
  return { language, languages, words };
}

export function registerSpellingTools(server: Tools): void {
  server.registerTool(
    "spelling_audit",
    {
      title: "Spelling audit — InDesign's dictionary and language settings",
      description:
        "Two families, both read-only: nothing is written to the document. " +
        "`language` — where the text's language SETTINGS are broken in such a way that checking silently does not " +
        "happen: `language-none` — a range with words that has no language assigned " +
        "at all (no dictionary, no hyphenation), and `language-stray` — a language that nowhere in the whole " +
        "document carries a single word yet is applied somewhere (a stray marker, " +
        "harmless). This is NOT a verdict on whether a language is appropriate: a book may hold two, three or " +
        "more languages, two texts may stand side by side (one translating the other), short " +
        "English insertions and quotations are an ordinary thing. The tool cannot in principle know " +
        "whether such text is intended, so instead of a verdict there is an INVENTORY (`languages`): how many " +
        "languages are in the document, how many words and ranges each has, what share, on which " +
        "pages (the first six, the full number in `pageCount`); it is always returned, " +
        "regardless of `family`. Master-page text is NOT included in the audit. " +
        "`dictionary` — words absent from the dictionary of THE SAME language that stands on " +
        "the range; the dictionary is the one InDesign itself checks with (the Hunspell shipped with " +
        "the application). The unit of the report is a WORD TYPE with a frequency, not an occurrence, and the rows go " +
        "by frequency UPWARDS: a typo occurs once, an authorial word forty times. “Absent " +
        "from the dictionary” does NOT mean “an error” (proper names, neologisms, borrowings) — such " +
        "rows are NOT counted as a deviation, the useful signal is the frequency itself. A range whose " +
        "language there was nothing to check with (no dictionary) is counted — `word-not-checked`, and " +
        "that IS a deviation: an unmarked state must not quietly pass for “clean”. " +
        "COMPLETENESS and DETAIL are separated: `words` carries structured rows (frequency, " +
        "pages, language) only for as many word types as the OVERALL byte budget of the whole response " +
        "leaves (`maxResponseBytes`, rarest first), whereas `wordsAll` and " +
        "`wordsNotCheckedAll` carry ALL word types as bare strings, without structure — the same " +
        "budget gives them priority over `words`, so they stay complete almost " +
        "always. Only on an inordinately large edition, where even the bare lists do not fit the " +
        "budget, are they truncated too — but that NEVER happens silently: `truncated` then names " +
        "the shown and the total counts separately for `words`, `wordsAll` and `wordsNotCheckedAll`. " +
        "LIMITS: the dictionary takes precedence over the 2019 orthography — a correctly typed «проєкт» will still " +
        "get `word-unknown`; that is a property of the source, not a flaw of the tool. Compound-word " +
        "rules (COMPOUNDRULE/COMPOUNDMIN/ONLYINCOMPOUND) in the dictionary are RECOGNISED " +
        "but NOT APPLIED — a compound form without its own entry will also get " +
        "`word-unknown`/`word-not-checked`. It does not check hyphenation and offers no " +
        "suggestions. The response names WHAT exactly the measurement used: the path, the number of stems and " +
        "the attribution of every dictionary actually loaded, and the list of languages for which " +
        "no dictionary was found — there is no silent zero in any branch.",
      inputSchema: {
        family: z.enum(["language", "dictionary"]).optional()
          .describe("Which family to run. Without this field — both."),
        maxResponseBytes: z.number().int().min(1000).max(500_000).optional()
          .describe(
            "A size budget in bytes for the WHOLE response (not just words). It first " +
              "guarantees the completeness of wordsAll/wordsNotCheckedAll (bare words, without structure), " +
              "then gives the rest to the structured rows of words (frequency, pages, language), " +
              "rarest first. If even the bare lists do not fit, it truncates them too, " +
              "but truncated always names what was shown and what was not.",
          ),
        languageDictionaries: z.record(z.string(), z.string().nullable()).optional()
          .describe(
            "A manual mapping from an InDesign language name (in English, as app.languages shows it) " +
              "to a dictionary code, e.g. { \"Czech\": \"cs_CZ\" }. InDesign does not hand back the dictionary " +
              "code, so the built-in mapping covers only a few of the commonest languages — " +
              "on an edition with a more complex language picture, name it here yourself.",
          ),
        expectedDocName: EXPECTED_DOC_NAME_FIELD,
      },
    },
    async ({ family, maxResponseBytes, languageDictionaries, expectedDocName }) => {
      try {
        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read", {},
        );
        assertExpectedDoc(read.docName, expectedDocName);

        const langs = await readLanguageRuns();
        /* The seam is checked on ALL read containers, before any filtering:
         * an offset mismatch between two bridge calls is a measurement
         * failure, and hiding it behind the audit filter would narrow the
         * safeguard down to only what we're already looking at. */
        assertLanguageCoverage(read.containers, langs);

        /* Master-page text is excluded from the audit — the same policy already
         * kept by both nearest neighbors: `typography_audit`
         * (tools/typography.ts, `if (snapshot.isMaster) continue`) and
         * `bibliography_audit` (bibliography/segment.ts). These are running
         * heads and helper frames, not the edition's text: a word from there
         * is not the author's typo, and `[No Language]` on a master would
         * have counted as a deviation with page "?", because master history
         * carries no page ranges. Branch's final review: before this line,
         * `spelling_audit` was the ONLY text audit in the repository without
         * this filter. */
        const audited = read.containers.filter((c) => !c.isMaster);
        const auditedIds = new Set(audited.map((c) => c.containerId));
        const auditedLangs = langs.filter((l) => auditedIds.has(l.containerId));

        /* The dictionary path is DERIVED from the installed build (spec §5): two
         * InDesign builds on the developer's machine can have different
         * copies of the dictionary. */
        /* Виділений читальний обробник, а не `run_script`: той обгортає тіло в
         * ENTIRE_SCRIPT-скасування і стоїть поза конвертом запису, тобто
         * читальний аудит відкривав би транзакцію в документі користувача
         * заради рядка, для якого не потрібен ані документ, ані скасування. */
        const appRoot = await runJsx<string>("app_path", {});

        /* Language names actually applied in the document (except [No Language] —
         * it has NO dictionary by definition, and that isn't "not measured",
         * it's a separate, already-named language-none defect). */
        const langNames = new Set<string>();
        for (const l of auditedLangs) {
          for (const r of l.runs) {
            if (r.language !== NO_LANGUAGE) langNames.add(r.language);
          }
        }

        /* The code for each name — with the override taking priority (spec §5.1, three sources). */
        const codeByName = new Map<string, string | null>();
        for (const name of langNames) codeByName.set(name, dictLangCode(name, languageDictionaries));

        const neededCodes = new Set<string>();
        for (const code of codeByName.values()) if (code !== null) neededCodes.add(code);

        /* `dicts` and `affs` are collected TOGETHER, with one file read per code:
         * word-splitting for each language follows the rules of ITS OWN .aff,
         * specifically the one the dictionary for that code was built from,
         * not some other one. A language with no code, or no entry of its
         * own here, falls back to DEFAULT_WORD_AFF inside
         * language.ts/unknown.ts. */
        const dicts = new Map<string, Dictionary>();
        const affs = new Map<string, Aff>();
        const sources: Array<{
          code: string;
          path: string;
          stems: number;
          vintage: string | null;
          affixGroups: { sfx: number; pfx: number };
          compoundRulesPresentNotApplied: boolean;
        }> = [];
        const failedCodes = new Set<string>();
        for (const code of neededCodes) {
          const src = dictPathsFor(appRoot, code);
          const loaded = loadDictionarySource(code, src);
          if (loaded === null) {
            /* The dictionary genuinely doesn't exist (ENOENT) — the family says
             * "not measured" via word-not-checked and
             * languagesWithoutDictionary, rather than a silent zero. Every
             * other error never reaches here — it's thrown further up, into
             * the outer catch, with the code and path as context. */
            failedCodes.add(code);
            continue;
          }
          dicts.set(code, loaded.dict);
          affs.set(code, loaded.aff);
          sources.push({
            code,
            path: loaded.path,
            stems: loaded.stems,
            vintage: loaded.vintage,
            affixGroups: loaded.affixGroups,
            compoundRulesPresentNotApplied: loaded.compoundRulesPresentNotApplied,
          });
        }

        /* Languages with no dictionary at all: either the code didn't resolve OR the file didn't read. */
        const languagesWithoutDictionary = [...langNames]
          .filter((name) => {
            const code = codeByName.get(name) ?? null;
            return code === null || failedCodes.has(code);
          })
          .sort();

        const collected = collectAudit(audited, auditedLangs, affs, dicts, {
          ...(family ? { family } : {}),
          ...(languageDictionaries ? { languageDictionaries } : {}),
        });

        /* Fields that `buildReport` does NOT return, and therefore can't see —
         * measured with the same `serialise` (UTF-8) that `ok()` itself uses
         * to serialize, and passed in as `otherFieldsBytes`: without this,
         * the budget would count as if the response consisted only of
         * `buildReport`'s fields, and the 45 KB "target" from round 1 would
         * once again be counting something other than what actually goes
         * over the wire (Task 16, round 2). */
        const otherFields = {
          docName: read.docName,
          dictionaries: sources,
          languagesWithoutDictionary,
          caveat:
            "The dictionary takes precedence over the 2019 orthography: a correctly typed «проєкт» will still get " +
            "word-unknown — that is a property of the source, not a flaw of the check. “Absent from the dictionary” " +
            "is NOT in itself an error: proper names, neologisms and borrowings are legitimately " +
            "absent. Compound-word rules (COMPOUNDRULE/COMPOUNDMIN/ONLYINCOMPOUND) " +
            "are recognised but NOT applied: a compound form without its own entry will also " +
            "get word-unknown/word-not-checked — which dictionaries declare them is " +
            "visible in dictionaries[].compoundRulesPresentNotApplied. Master-page text " +
            "(running heads, helper frames) is NOT included in the audit — the same limit as in " +
            "typography_audit and bibliography_audit.",
          languages: collected.languages,
        };
        const otherFieldsBytes = Buffer.byteLength(serialise(otherFields), "utf8");

        return ok({
          ...otherFields,
          ...buildReport({
            language: collected.language,
            words: collected.words,
            ...(maxResponseBytes ? { maxResponseBytes } : {}),
            otherFieldsBytes,
          }),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
