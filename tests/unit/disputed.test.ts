import { describe, expect, it } from "vitest";
import { explain, reconcile, type DisputedItem } from "../../src/corrections/disputed.js";

describe("explain", () => {
  it("дає людський текст для кожної причини", () => {
    expect(explain("ambiguous-anchor")).toContain("unambiguous");
    expect(explain("editor-mistake")).toContain("editor");
    expect(explain("competing-edits")).toContain("same sentence");
  });

  it("додає деталь, коли її передано", () => {
    const text = explain("ambiguous-anchor", "знайдено 4 місця");
    expect(text).toContain("знайдено 4 місця");
  });
});

describe("reconcile", () => {
  it("баланс сходиться, коли кожен запит або внесено, або винесено", () => {
    const r = reconcile({
      requestIds: ["a", "b", "c"],
      appliedIds: ["a", "c"],
      disputedIds: ["b"],
    });
    expect(r.balanced).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.duplicated).toEqual([]);
  });

  it("ловить запит, що зник безслідно", () => {
    const r = reconcile({ requestIds: ["a", "b"], appliedIds: ["a"], disputedIds: [] });
    expect(r.balanced).toBe(false);
    expect(r.missing).toEqual(["b"]);
  });

  it("ловить запит, що потрапив і туди, і туди", () => {
    const r = reconcile({ requestIds: ["a"], appliedIds: ["a"], disputedIds: ["a"] });
    expect(r.balanced).toBe(false);
    expect(r.duplicated).toEqual(["a"]);
  });

  it("ловить дублікат усередині applied", () => {
    const r = reconcile({
      requestIds: ["a", "b"],
      appliedIds: ["a", "a"],
      disputedIds: ["b"],
    });
    expect(r.balanced).toBe(false);
    expect(r.duplicated).toContain("a");
  });

  it("ловить дублікат усередині disputed", () => {
    const r = reconcile({
      requestIds: ["a", "b"],
      appliedIds: ["a"],
      disputedIds: ["b", "b"],
    });
    expect(r.balanced).toBe(false);
    expect(r.duplicated).toContain("b");
  });

  it("ловить сторонній id у applied і робить balanced хибним", () => {
    const r = reconcile({
      requestIds: ["a", "b"],
      appliedIds: ["a", "x"],
      disputedIds: ["b"],
    });
    expect(r.balanced).toBe(false);
    expect(r.unknown).toContain("x");
  });

  it("порожні списки залишаються збалансованими, коли requestIds теж порожній", () => {
    const r = reconcile({
      requestIds: [],
      appliedIds: [],
      disputedIds: [],
    });
    expect(r.balanced).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.duplicated).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it("ловить сторонній id у disputed", () => {
    const r = reconcile({
      requestIds: ["a"],
      appliedIds: ["a"],
      disputedIds: ["x"],
    });
    expect(r.balanced).toBe(false);
    expect(r.unknown).toContain("x");
  });
});

describe("нові причини Фази 3", () => {
  it("text-changed пояснює, що текст змінився між планом і записом", () => {
    const text = explain("text-changed");
    expect(text).toContain("changed");
    expect(text.length).toBeGreaterThan(20);
  });

  it("write-failed називає заблокований шар як імовірну причину", () => {
    const text = explain("write-failed");
    expect(text).toContain("locked");
  });

  it("explain додає деталь, коли її передано", () => {
    const text = explain("write-failed", "Шар «Текст» заблоковано.");
    expect(text).toContain("Шар «Текст» заблоковано.");
  });
});

describe("DisputedItem", () => {
  it("несе причину й пояснення разом", () => {
    const item: DisputedItem = {
      number: 212,
      requestId: "r-212",
      page: "88",
      reason: "editor-mistake",
      explanation: explain("editor-mistake", "«вони» замість «воно» ламає узгодження"),
    };
    expect(item.explanation.length).toBeGreaterThan(20);
  });
});
