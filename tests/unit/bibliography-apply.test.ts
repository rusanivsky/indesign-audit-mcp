import { describe, expect, it } from "vitest";
import type { Finding } from "../../src/bibliography/types.js";
import {
  assertExpectedRecords,
  assertKnownRules,
  bibFindingsToEdits,
} from "../../src/tools/bibliography.js";

const f = (over: Partial<Finding>): Finding => ({
  ruleId: "chicago-colon-spacing",
  title: "t",
  confidence: "high",
  recordNumber: 1,
  containerId: "story:245",
  page: "4",
  zone: "place",
  start: 10,
  end: 12,
  before: " :",
  suggested: ":",
  contextBefore: "",
  contextAfter: "",
  basis: "CMOS",
  ...over,
});

describe("bibliography_apply", () => {
  it("порожня заміна — це ВИДАЛЕННЯ, а не заміна на порожнє", () => {
    /*
     * Домовленість решти коду: "delete" кличе range.remove(), "replace"
     * присвоює range.contents. Присвоєння порожнього рядка на "replace" не має
     * прецеденту ніде й ніколи не міряне на живому InDesign.
     */
    const [del] = bibFindingsToEdits([f({ suggested: "", ruleId: "chicago-extent" })]);
    expect(del?.action).toBe("delete");
    const [rep] = bibFindingsToEdits([f({})]);
    expect(rep?.action).toBe("replace");
  });

  it("перекриті знахідки не пишуться обидві", () => {
    const edits = bibFindingsToEdits([
      f({ start: 10, end: 20 }),
      f({ start: 15, end: 25, ruleId: "chicago-zone-separator" }),
    ]);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.start).toBe(10);
  });

  it("знахідки в різних контейнерах не вважаються перекритими", () => {
    const edits = bibFindingsToEdits([
      f({ containerId: "story:1", start: 10, end: 20 }),
      f({ containerId: "story:2", start: 15, end: 25 }),
    ]);
    expect(edits).toHaveLength(2);
  });

  it("expectedOld несе те, що мусить стояти в діапазоні", () => {
    const [e] = bibFindingsToEdits([f({})]);
    expect(e?.expectedOld).toBe(" :");
    expect(e?.start).toBe(10);
    expect(e?.end).toBe(12);
  });

  it("ВОРОТА: невідоме правило називає себе, а не мовчить", () => {
    /*
     * Фільтр за невідомим id дає порожній список правил, той — нуль знахідок,
     * а нуль знахідок не відрізнити від «документ чистий».
     */
    expect(() => assertKnownRules("chicago", ["chicago-colon-spacing"])).not.toThrow();
    expect(() => assertKnownRules("chicago", ["bib-zone-separator"])).toThrow(
      /bib-zone-separator/u,
    );
    expect(() => assertKnownRules("7.1", ["chicago-extent"])).toThrow(/Available/u);
  });

  it("ВОРОТА: інша кількість записів спиняє запис", () => {
    expect(() => assertExpectedRecords(1, 1)).not.toThrow();
    expect(() => assertExpectedRecords(7, 1)).toThrow(/7/u);
    expect(() => assertExpectedRecords(0, 1)).toThrow(/Nothing has been changed/u);
  });
});
