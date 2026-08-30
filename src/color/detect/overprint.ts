/**
 * Family `overprint` — what happens with ink overprint.
 *
 * On the working book: ZERO across 1128 elements; proven by fixture.
 *
 * The family's main rule isn't "overprint is on" but overprint ON WHITE:
 * a white object with overprint knocks nothing out and simply vanishes
 * from the sheet, while staying visible on screen. This is the most
 * expensive kind: it's invisible until the job is actually printed.
 */
import { buildFindings } from "../findings.js";
import { classifyBlack, effectiveTint } from "../ink.js";
import type { ColorFinding, ColorSite } from "../types.js";

const ownerExample = (group: ColorSite[]): string[] => {
  const first = group[0];
  return first ? [first.ownerKind] : [];
};

/**
 * «Білим» тут є все, що НЕ КЛАДЕ ФАРБИ, — а це залежить і від відтінку.
 *
 * Складники 0/0/0/100 при відтінку 0 дають нуль фарби так само, як свотч
 * 0/0/0/0 при будь-якому відтінку. Доти перевірялися лише сирі складники,
 * тож перший випадок «білим» не вважався, далі відсіювався як `pure-k` — і
 * надрук поверх нічого лишався непоміченим.
 */
function isWhite(site: ColorSite): boolean {
  if (site.color.named === "Paper") return true;
  if (site.color.space !== "CMYK" || site.color.value === null) return false;
  const factor = effectiveTint(site.tint) / 100;
  for (const v of site.color.value) if (v * factor !== 0) return false;
  return true;
}

export function detectOverprintSuspicious(sites: ColorSite[]): ColorFinding[] {
  const white: ColorSite[] = [];
  const nonK: ColorSite[] = [];
  for (const s of sites) {
    if (s.overprint !== true) continue;
    if (isWhite(s)) {
      white.push(s);
      continue;
    }
    /* Pure K with overprint is normal layout practice, not a defect. */
    if (classifyBlack(s.color, s.tint) === "pure-k") continue;
    nonK.push(s);
  }
  return [
    ...buildFindings(white, "overprint", "overprint-on-white", ownerExample),
    ...buildFindings(nonK, "overprint", "overprint-non-k", ownerExample),
  ];
}
