import type { DictSource } from "./types.js";

const SUFFIX = "Resources/Dictionaries/LILO/Linguistics/Providers/Plugins2/"
  + "AdobeHunspellPlugin.bundle/Contents/SharedSupport/Dictionaries";

/**
 * The path is DERIVED from the install location, not hardcoded: on the
 * developer's machine there are two builds (2026 and 2026 Beta) with
 * different copies of the dictionary, and on another machine the path
 * differs.
 */
export function dictPathsFor(appRoot: string, langCode: string): DictSource {
  const dir = `${appRoot}/${SUFFIX}/${langCode}`;
  // Attribution exists only for the Ukrainian dictionary (spell-uk).
  // For other languages — null, meaning "attribution not measured".
  const vintage = langCode === "uk_UA" ? "spell-uk, © 1999–2009" : null;
  return {
    dicPath: `${dir}/${langCode}.dic`,
    affPath: `${dir}/${langCode}.aff`,
    vintage,
  };
}

/*
 * `availableDictCodes(appRoot)` used to stand here — a walk of the dictionary
 * subfolders on disk, declared by spec §5.1 as "source #1 of three". Removed
 * by the final branch review: it was exported, covered by a test, and NOT
 * CALLED by any production line. The reason isn't an oversight but that
 * another path turned out better than the original design:
 * `loadDictionarySource` (tools/spelling.ts) answers the same question MORE
 * PRECISELY — not "does a folder with this name exist" but "can this exact
 * .dic and .aff be read", and it distinguishes ENOENT (no dictionary — a
 * measured state) from other errors (throws with context). Walking the
 * folder would have added another path to the same answer, one that could
 * have drifted from it. Spec §5.1 has been brought into line.
 */

/**
 * InDesign language names are ENGLISH strings. On a localized build the
 * mapping won't work and the `language` family will silently return zeros —
 * the same limitation already named for the `usage` family in styles_audit
 * (spec §6).
 */
/*
 * П'ЯТЬ АНГЛІЙСЬКИХ НАЗВ, А НЕ ДВІ — І ЦЕ ВЖЕ БУЛО ЗМІРЯНО В ЦЬОМУ Ж
 * РЕПОЗИТОРІЇ.
 *
 * `src/typography/locale.ts` зафіксував вимір `app.languagesWithVendors` на
 * InDesign 21.5.1.73 (2026-08-25): англійських назв п'ять — `English: UK`,
 * `English: USA`, `English: Canadian`, `English: USA Medical`,
 * `English: USA Legal`, — і прямо застерігає, що «ворота на буквальному
 * "English: USA" замовкли б на Medical і Legal». Тут ворота саме такі й були.
 *
 * Ціна мовчання видима: абзац, позначений `English: Canadian`, діставав
 * `dictLangCode === null`, `detectUnknown` розмічав КОЖНЕ його слово як
 * `word-not-checked`, а `word-not-checked` рахується в `deviating`. Тобто
 * коректний англійський текст роздувáв число відхилень, і причина в звіті не
 * називалася.
 *
 * Medical і Legal — це американські ФАХОВІ словники поверх того самого
 * правопису, тож en_US для них правильний за орфографією; Canadian
 * приписано до en_GB, бо канадський правопис британський (кольори через
 * «-our»), а `locale.ts` навмисно не вгадує ШКОЛУ пунктуації — тут же
 * йдеться лише про словник слів.
 */
const BUILTIN_LANG_CODES = new Map<string, string>([
  ["Ukrainian", "uk_UA"],
  ["English: USA", "en_US"],
  ["English: USA Medical", "en_US"],
  ["English: USA Legal", "en_US"],
  ["English: UK", "en_GB"],
  ["English: Canadian", "en_GB"],
  ["Polish", "pl_PL"],
  ["German", "de_DE"],
  ["French", "fr_FR"],
  ["Russian", "ru_RU"],
]);

/**
 * Maps an InDesign language name to a dictionary code. First checks the
 * override parameter (lets a call redefine the mapping for this book), then
 * the built-in names. Returns null for an unknown language or [No Language],
 * meaning "no dictionary" — a measured state, not an error.
 */
export function dictLangCode(
  indesignLanguageName: string,
  override?: Record<string, string | null>,
): string | null {
  // Check override first: a call can redefine any mapping.
  if (override !== undefined) {
    const overrideMap = new Map(Object.entries(override));
    if (overrideMap.has(indesignLanguageName)) {
      return overrideMap.get(indesignLanguageName) ?? null;
    }
  }

  // Then the built-in names via a Map, which protects against prototype pollution.
  return BUILTIN_LANG_CODES.get(indesignLanguageName) ?? null;
}
