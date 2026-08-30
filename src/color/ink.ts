/**
 * Ink arithmetic. Pure functions: no calls into InDesign, no state.
 * Everything here is provable from a table in and a number out.
 */
import { formatComponents, type ColorRef } from "./types.js";

/**
 * Minimum K at which a color is considered black at all.
 *
 * THIS IS A CONVENTION, NOT A MEASUREMENT, and the report declares it as
 * applied. Rationale: below 60% the color reads as gray or as a color, and
 * a "rich black" verdict stops being about black.
 */
export const RICH_BLACK_MIN_K = 60;

/**
 * Minimum C/M/Y admixture at which black is considered rich.
 *
 * ALSO A CONVENTION. Reason for a nonzero threshold: 2% cyan from profile
 * rounding doesn't make black a four-color mix in practice, and a threshold
 * of 0 would flag every such color as a finding.
 */
export const RICH_BLACK_MIN_CHROMA = 10;

/** −1 in InDesign means "tint not set", i.e. a full 100%. NOT zero. */
export function effectiveTint(tint: number): number {
  return tint === -1 ? 100 : tint;
}

/**
 * Total ink at a point, in percent.
 *
 * `null` — when ink isn't a meaningful concept: RGB and Lab describe LIGHT,
 * and the sum of their components means nothing. Silently returning zero
 * for them would make RGB colors the "cleanest" in the report.
 */
export function totalInk(color: ColorRef, tint: number): number | null {
  if (color.space !== "CMYK" || color.value === null || color.value.length < 4) return null;
  let sum = 0;
  for (const v of color.value) sum += v;
  return (sum * effectiveTint(tint)) / 100;
}

export type BlackKind = "not-black" | "pure-k" | "rich" | "registration";

/**
 * ВІДТІНОК УЧАСТЬ БЕРЕ, І ДО 2026-08-26 НЕ БРАВ.
 *
 * `totalInk` завжди множив на відтінок, а `classifyBlack` дивився на сирі
 * складники свотча — дві функції в одному файлі відповідали на питання про
 * ту саму фарбу по-різному. Наслідок був з обох боків:
 *
 *   ХИБНЕ СПРАЦЮВАННЯ. Свотч «Rich Black» 60/40/40/100, застосований до
 *   тексту 10 pt при ВІДТІНКУ 20, кладе 12/8/8/20 — світло-сірий. Родина
 *   `black` звітувала «насичений чорний під дрібним текстом» про сірий текст.
 *
 *   ПРОПУСК. 0/0/0/100 при відтінку 0 не кладе фарби ЗОВСІМ, але
 *   класифікувався як `pure-k`, тож `detectOverprintSuspicious` пропускав
 *   його рядком `continue` — і випадок `overprint-on-white`, який сам модуль
 *   зве найдорожчим (видно лише на відбитку), не фіксувався.
 *
 * Відтінок множить УСІ складники пропорційно, тож достатньо звести їх перед
 * класифікацією. Замовчування −1 (тобто 100 %) лишає поведінку без відтінку
 * незмінною: жоден наявний виклик без другого аргументу не змінює вердикту.
 *
 * `[Registration]` СВІДОМО лишається поза цим: рішення «без порогу й без
 * параметра» ухвалено окремо і стосується наявності фарби в макеті, а не її
 * кількості на відбитку.
 */
export function classifyBlack(color: ColorRef, tint: number = -1): BlackKind {
  if (color.model === "REGISTRATION") return "registration";
  if (color.space !== "CMYK" || color.value === null || color.value.length < 4) return "not-black";
  const factor = effectiveTint(tint) / 100;
  const [c, m, y, k] = (color.value as [number, number, number, number]).map(
    (v) => v * factor,
  ) as [number, number, number, number];
  if (k < RICH_BLACK_MIN_K) return "not-black";
  const chroma = Math.max(c, m, y);
  return chroma >= RICH_BLACK_MIN_CHROMA ? "rich" : "pure-k";
}

/**
 * Distance between colors — the LARGEST per-component difference, not the
 * sum and not the Euclidean norm.
 *
 * Reason: a 5% difference in each of four inks and a 20% difference in one
 * are different events for the eye, but a sum would equate them both at 20.
 * The largest component answers the question "how noticeably different",
 * which is exactly what a near-miss asks.
 *
 * `null` for mismatched spaces: the incomparable has no distance.
 */
export function colorDistance(a: ColorRef, b: ColorRef): number | null {
  if (a.space !== b.space) return null;
  if (a.value === null || b.value === null) return null;
  if (a.value.length !== b.value.length) return null;
  const aVal: number[] = a.value;
  const bVal: number[] = b.value;
  let worst = 0;
  for (let i = 0; i < aVal.length; i++) {
    worst = Math.max(worst, Math.abs(aVal[i]! - bVal[i]!));
  }
  return worst;
}

export function describeColor(color: ColorRef, tint: number): string {
  const head = color.named === null ? "unnamed" : `"${color.named}"`;
  const body = `${color.space} ${formatComponents(color.value)}`;
  const t = effectiveTint(tint);
  return t === 100 ? `${head} ${body}` : `${head} ${body} @${t}%`;
}
