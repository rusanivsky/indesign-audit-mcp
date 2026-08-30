import { describe, expect, it } from "vitest";
import {
  detectRegistrationApplied,
  detectRichBlackSmallText,
} from "../../src/color/detect/black.js";
import type { ColorSite } from "../../src/color/types.js";

const REGISTRATION = {
  named: "Registration", model: "REGISTRATION" as const, space: "CMYK" as const,
  value: [100, 100, 100, 100], kind: "solid" as const,
};

function site(over: Partial<ColorSite> = {}): ColorSite {
  return {
    siteId: 1, surface: "pageItem", role: "fill", ownerKind: "Rectangle",
    ownerName: null, page: "5", master: null, layer: "01", printable: true,
    visible: true, laysInk: true,
    color: { named: "Black", model: "PROCESS", space: "CMYK", value: [0, 0, 0, 100], kind: "solid" },
    tint: -1, overprint: false, pointSize: null, ...over,
  };
}

describe("detectRegistrationApplied", () => {
  it("знаходить [Registration] на об'єкті — та сама порода, що коштувала тиражу", () => {
    const found = detectRegistrationApplied([site({ color: REGISTRATION })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("registration-applied");
  });

  it("знаходить [Registration] на тексті", () => {
    const found = detectRegistrationApplied([
      site({ surface: "textRange", ownerKind: "Text", color: REGISTRATION, pointSize: 11 }),
    ]);
    expect(found).toHaveLength(1);
  });

  it("МОВЧИТЬ про сам зразок у палітрі: його не можна видалити, і він є завжди", () => {
    const definition = site({ surface: "swatch", role: "definition", color: REGISTRATION });
    expect(detectRegistrationApplied([definition])).toEqual([]);
  });

  it("МОВЧИТЬ про звичайний чорний", () => {
    expect(detectRegistrationApplied([site()])).toEqual([]);
  });
});

describe("detectRichBlackSmallText", () => {
  const rich = {
    named: null, model: "PROCESS" as const, space: "CMYK" as const,
    value: [76, 48, 66, 70], kind: "solid" as const,
  };

  it("знаходить дрібний текст, набраний збагаченим чорним", () => {
    const found = detectRichBlackSmallText(
      [site({ surface: "textRange", color: rich, pointSize: 9 })], 24,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("rich-black-small-text");
  });

  it("МОВЧИТЬ про великий кегль: на 48 pt несумісок непомітний", () => {
    expect(detectRichBlackSmallText(
      [site({ surface: "textRange", color: rich, pointSize: 48 })], 24,
    )).toEqual([]);
  });

  it("МОВЧИТЬ про дрібний текст чистою K — це вся книжка, 1727 діапазонів", () => {
    expect(detectRichBlackSmallText(
      [site({ surface: "textRange", pointSize: 8 })], 24,
    )).toEqual([]);
  });

  it("МОВЧИТЬ про збагачений чорний на ПЛАШЦІ: там немає кегля й немає ореолу", () => {
    expect(detectRichBlackSmallText([site({ color: rich })], 24)).toEqual([]);
  });

  it("[Registration] на дрібному тексті теж потрапляє сюди — 400 і є збагачений", () => {
    const found = detectRichBlackSmallText(
      [site({ surface: "textRange", color: REGISTRATION, pointSize: 9 })], 24,
    );
    expect(found).toHaveLength(1);
  });
});
