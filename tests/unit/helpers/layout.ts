import type { PageMeasure, ParagraphMeasure, StyleValues } from "../../../src/layout/types.js";

/** Значення «чистого» стилю. Усі тести відштовхуються від нього. */
export const BASE: StyleValues = {
  firstLineIndent: 12,
  leftIndent: 0,
  rightIndent: 0,
  spaceBefore: 0,
  spaceAfter: 0,
  pointSize: 11,
  leading: 14,
  justification: "LEFT_JUSTIFIED",
  appliedFont: "Minion Pro",
  fontStyle: "Regular",
  tracking: 0,
  listType: "NO_LIST",
};

/**
 * Абзац для юніт-тестів. За замовчуванням — чистий: `actual` дорівнює
 * `declared`. Перевизначення задаються через `actual`, і лише названі поля
 * відхиляються від бази.
 */
export function paragraph(opts: {
  index?: number;
  style?: string;
  /** `.id` стилю. Замовчування навмисно НЕ залежить від `style` (назви) — саме ця незалежність і є суттю Задачі 12: два різні стилі можуть звати однаково. */
  styleId?: string;
  actual?: Partial<StyleValues>;
  declared?: Partial<StyleValues>;
  isMaster?: boolean;
  hasCharacterStyleRuns?: boolean;
  page?: string | null;
  preview?: string;
} = {}): ParagraphMeasure {
  return {
    containerId: "story:0",
    paragraphIndex: opts.index ?? 0,
    page: opts.page === undefined ? "1" : opts.page,
    styleName: opts.style ?? "Osnovnyi",
    styleId: opts.styleId ?? "100",
    isMaster: opts.isMaster ?? false,
    declared: { ...BASE, ...opts.declared },
    actual: { ...BASE, ...opts.declared, ...opts.actual },
    hasCharacterStyleRuns: opts.hasCharacterStyleRuns ?? false,
    preview: opts.preview ?? "Zvychainyi abzats",
  };
}

export function page(opts: Partial<PageMeasure> & { name: string }): PageMeasure {
  return {
    side: "right",
    master: "L-Master",
    frameCount: 1,
    masterItems: [],
    guideCount: 0,
    pageItems: [],
    expectedMasterItems: [],
    ...opts,
  };
}
