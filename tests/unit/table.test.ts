import { describe, expect, it } from "vitest";
import { explain, type DisputedItem } from "../../src/corrections/disputed.js";
import { buildTable, renderMarkdown } from "../../src/corrections/table.js";

const applied = [
  { requestId: "r1", page: "12", before: "знаннь", after: "знання" },
  { requestId: "r3", page: "14", before: "мамо", after: "мамою" },
];

const disputed: DisputedItem[] = [
  {
    number: 0, // buildTable перезаписує
    requestId: "r2",
    page: "13",
    reason: "editor-mistake",
    explanation: explain("editor-mistake"),
  },
];

describe("buildTable", () => {
  it("нумерує наскрізно від переданого старту", () => {
    const t = buildTable({ startNumber: 212, order: ["r1", "r2", "r3"], applied, disputed });
    expect(t.entries.map((e) => e.number)).toEqual([212, 213, 214]);
    expect(t.nextNumber).toBe(215);
  });

  it("нумерує в порядку запитів, а не «спершу внесені»", () => {
    const t = buildTable({ startNumber: 1, order: ["r1", "r2", "r3"], applied, disputed });
    expect(t.entries.map((e) => e.requestId)).toEqual(["r1", "r2", "r3"]);
    expect(t.entries[1]!.kind).toBe("disputed");
  });

  it("спірні мають номери з тієї самої послідовності", () => {
    const t = buildTable({ startNumber: 100, order: ["r1", "r2", "r3"], applied, disputed });
    const d = t.entries.find((e) => e.kind === "disputed")!;
    expect(d.number).toBe(101);
  });

  it("рахує внесені й спірні окремо", () => {
    const t = buildTable({ startNumber: 1, order: ["r1", "r2", "r3"], applied, disputed });
    expect(t.counts).toEqual({ applied: 2, disputed: 1, alreadyApplied: 0 });
  });

  it("кидає, якщо запит із order не потрапив у жоден список", () => {
    expect(() =>
      buildTable({ startNumber: 1, order: ["r1", "r2", "r3", "r9"], applied, disputed }),
    ).toThrow(/r9/);
  });
});

describe("renderMarkdown", () => {
  it("дає дві таблиці: внесені і спірні", () => {
    const md = renderMarkdown(
      buildTable({ startNumber: 212, order: ["r1", "r2", "r3"], applied, disputed }),
    );
    expect(md).toContain("| 212 | 12 |");
    expect(md).toContain("Needs attention");
    expect(md).toContain("213");
  });

  it("не малює блок спірних, коли їх немає", () => {
    const md = renderMarkdown(
      buildTable({ startNumber: 1, order: ["r1", "r3"], applied, disputed: [] }),
    );
    expect(md).not.toContain("Needs attention");
  });
});

describe("третій вид запису", () => {
  it("already-applied нумерується разом з рештою і має власний вид", () => {
    const t = buildTable({
      startNumber: 1,
      order: ["r1", "r2"],
      applied: [{ requestId: "r1", page: "5", before: "а", after: "б" }],
      disputed: [],
      alreadyApplied: [{ requestId: "r2", page: "6", text: "вже стоїть" }],
      notSubmitted: [],
    });
    expect(t.entries.map((e) => e.kind)).toEqual(["applied", "already-applied"]);
    expect(t.entries.map((e) => e.number)).toEqual([1, 2]);
    expect(t.counts).toEqual({ applied: 1, disputed: 0, alreadyApplied: 1 });
  });

  it("неподані пункти не нумеруються і не вважаються втраченими", () => {
    const t = buildTable({
      startNumber: 10,
      order: ["r1"],
      applied: [{ requestId: "r1", page: "5", before: "а", after: "б" }],
      disputed: [],
      alreadyApplied: [],
      notSubmitted: ["r9", "r8"],
    });
    expect(t.notSubmitted).toEqual(["r9", "r8"]);
    expect(t.entries).toHaveLength(1);
    expect(t.nextNumber).toBe(11);
  });

  it("кидає, коли запит із order не потрапив у жоден список", () => {
    expect(() =>
      buildTable({
        startNumber: 1,
        order: ["r1", "привид"],
        applied: [{ requestId: "r1", page: "5", before: "а", after: "б" }],
        disputed: [],
        alreadyApplied: [],
        notSubmitted: [],
      }),
    ).toThrow(/привид/);
  });

  it("renderMarkdown дає окремий розділ для вже застосованих", () => {
    const md = renderMarkdown(
      buildTable({
        startNumber: 1,
        order: ["r2"],
        applied: [],
        disputed: [],
        alreadyApplied: [{ requestId: "r2", page: "6", text: "вже стоїть" }],
        notSubmitted: [],
      }),
    );
    expect(md).toContain("Already in the document");
    expect(md).toContain("вже стоїть");
  });
});
