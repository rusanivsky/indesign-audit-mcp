import { describe, expect, it } from "vitest";
import { detectOverprintSuspicious } from "../../src/color/detect/overprint.js";
import type { ColorSite } from "../../src/color/types.js";

function site(over: Partial<ColorSite> = {}): ColorSite {
  return {
    siteId: 1, surface: "pageItem", role: "fill", ownerKind: "Rectangle",
    ownerName: null, page: "5", master: null, layer: "01", printable: true,
    visible: true, laysInk: true,
    color: { named: "Black", model: "PROCESS", space: "CMYK", value: [0, 0, 0, 100], kind: "solid" },
    tint: -1, overprint: true, pointSize: null, ...over,
  };
}

describe("detectOverprintSuspicious", () => {
  it("overprint на білому — окреме правило: на екрані видно, на аркуші зникає", () => {
    const found = detectOverprintSuspicious([site({
      color: { named: "Paper", model: "PROCESS", space: "CMYK", value: [0, 0, 0, 0], kind: "solid" },
    })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("overprint-on-white");
  });

  it("overprint на кольорі, що не є чистою K", () => {
    const found = detectOverprintSuspicious([site({
      color: { named: null, model: "PROCESS", space: "CMYK", value: [20, 100, 90, 10], kind: "solid" },
    })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("overprint-non-k");
  });

  it("МОВЧИТЬ про overprint на чистій K — це нормальна практика, а не вада", () => {
    expect(detectOverprintSuspicious([site()])).toEqual([]);
  });

  it("МОВЧИТЬ, коли overprint вимкнено — стан усіх 1128 елементів книжки", () => {
    expect(detectOverprintSuspicious([site({ overprint: false })])).toEqual([]);
  });

  it("МОВЧИТЬ, коли overprint не прочитався: null — це не «увімкнено»", () => {
    expect(detectOverprintSuspicious([site({ overprint: null })])).toEqual([]);
  });
});

/*
 * НАДРУК ПОВЕРХ НІЧОГО — той самий випадок, що й overprint-on-white, лише
 * записаний відтінком, а не складниками. Модуль сам зве його найдорожчим:
 * на екрані видно, на відбитку зникає.
 */
describe("overprint і відтінок", () => {
  it("0/0/0/100 при відтінку 0 — це надрук поверх БІЛОГО", () => {
    const found = detectOverprintSuspicious([site({ tint: 0 })]);
    expect(found).toHaveLength(1);
    expect(found[0]!.rule).toBe("overprint-on-white");
  });

  it("ПОЗИТИВНИЙ БЛИЗНЮК: та сама фарба при повному відтінку — звичайна практика, не дефект", () => {
    /* Чиста K з надруком — нормальний прийом верстки. Якби правка зробила
     * «білим» усе підряд, цей випадок теж став би знахідкою. */
    expect(detectOverprintSuspicious([site({ tint: -1 })])).toHaveLength(0);
  });
});
