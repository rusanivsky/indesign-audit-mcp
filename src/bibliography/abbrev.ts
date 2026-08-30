/**
 * The abbreviation lexicon. ДСТУ 3582:2013 (Ukrainian) and ДСТУ 7093:2009
 * (foreign-language).
 *
 * This is a KNOWINGLY incomplete list, and that's exactly why the rule that
 * uses it is permanently `needs-review`: the standard doesn't cover
 * institution names, series titles, or periodicals, and those make up most of
 * the index. The list below was compiled from a measured corpus of three
 * issues of the series — the most frequent entries, not all of them.
 */
const BASE = [
  "акад", "альм", "англ", "аналіт", "арк", "археол", "архів", "асоц", "авт",
  /*
   * "б-ки" (genitive) and "б-ці" (locative) are inflected forms of "б-ка", not a
   * separate abbreviation. The lexicon deliberately does NOT lemmatize (cf.
   * "ун-т"/"ун-ту" — that same pair below is entered explicitly, not derived),
   * so forms that actually occur in the corpus are added to the list literally.
   */
  "б-ка", "б-ки", "б-ці", "бібліогр", "biol", "бюл", "вид", "вип", "вид-во", "вісн", "вступ",
  "газ", "геогр", "гол", "грудн", "губ",
  "держ", "довід", "доп", "дослідж", "друк",
  "екон", "енцикл", "етногр",
  "журн", "заг", "закл", "заруб", "зб", "зібр",
  "ін", "ін-т", "інформ", "іст", "іл",
  "каф", "керів", "кн", "коміс", "комент", "конф", "краєзн",
  "лист", "літ", "лют",
  "мат", "матеріали", "мед", "метод", "міжнар", "мов", "муз",
  "навч", "наук", "нац", "нотат", "обл", "образотв", "опубл", "орг", "осв",
  "пед", "пер", "передм", "переклад", "півн", "півд", "покажч", "політ",
  "попул", "портр", "посіб", "практ", "прим", "пр", "проф", "публіцист",
  "ред", "редкол", "рец", "рис", "рік", "рос",
  "с", "серп", "симп", "слов", "соц", "спец", "співавт", "ст", "студ",
  "т", "т-во", "табл", "теорет", "техн", "тем", "тис", "торг",
  "уклад", "ун-т", "ун-ту", "упоряд", "укр", "фак", "філол", "філос", "фот",
  "худож", "ч", "чис", "шк", "юрид",
];

/** Abbreviations that don't end in a period — hyphenated contractions. */
const NO_DOT = new Set(["б-ка", "ін-т", "т-во", "ун-т", "ун-ту", "б-ки", "б-ці"]);

export const KNOWN_ABBREVIATIONS: ReadonlySet<string> = new Set([
  ...BASE.map((w) => (NO_DOT.has(w) ? w : `${w}.`)),
  ...BASE.map((w) => `${w.charAt(0).toUpperCase()}${w.slice(1)}${NO_DOT.has(w) ? "" : "."}`),
]);

/**
 * Compound abbreviations are written hyphenated WITHOUT spaces: `наук.-практ.`,
 * `іст.-краєзн.`, `авт.-упоряд.` Two issues of the series have 394 and 395 of
 * these, all of them legitimate. Each half is checked separately.
 */
export function isKnownAbbreviation(word: string): boolean {
  const clean = word.trim();
  if (clean === "") return false;
  if (KNOWN_ABBREVIATIONS.has(clean)) return true;
  if (clean.includes(".-")) {
    return clean
      .split(".-")
      .map((part, i, all) => (i === all.length - 1 ? part : `${part}.`))
      .every((part) => KNOWN_ABBREVIATIONS.has(part));
  }
  return false;
}
