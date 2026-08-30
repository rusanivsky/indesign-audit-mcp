import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const JSX = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "jsx", "pagination.jsx");

/*
 * THE CHARACTER CLASS THAT COMPILED, LOOKED RIGHT, AND MATCHED ALMOST NOTHING.
 *
 * `headClaim` filters manual folio literals out of the running-head family by
 * asking whether a frame holds nothing but digits, spaces and dashes. It was
 * written as:
 *
 *     /^[0-9\s-‐-―]+$/
 *
 * The plain hyphen sits between `\s` and `‐`, so the regex engine reads it as a
 * RANGE OPERATOR whose left side has already been consumed. The intended
 * `‐`–`―` range never forms; U+2011, U+2012, U+2013 and U+2014 drop out of the
 * class. Nothing throws, nothing warns — the class quietly narrows to U+2010 and
 * U+2015, two dashes nobody sets in a folio.
 *
 * U+2013 is the en dash. This publisher sets it in a page range by rule, and the
 * docstring above the line names «8–9» as the very frame the filter exists for.
 * So on the working book every manual folio range was handed to the running-head
 * family: phantom `head-unexpected` findings, a `headReference` mode computed
 * over folios rather than running heads, and — the expensive half — a page that
 * had LOST its running head still counted as "shown", so `head-missing` stayed
 * silent.
 *
 * `tests/integration/pagination-heads.test.ts:82` writes the same class with the
 * dash LAST, which builds the range correctly. The test and the code it guards
 * therefore disagreed, and because that test needs a live InDesign, a green unit
 * suite could never show it.
 *
 * This test reads the class out of the shipped source rather than restating it,
 * so it fails if the dash is ever moved back into the middle. Duplicating the
 * literal here would only prove that a copy of the regex works.
 */
describe("the folio dash class in pagination.jsx", () => {
  const source = readFileSync(JSX, "utf8");

  /* The one executable occurrence, not the several inside the comments above it. */
  const line = source
    .split("\n")
    .find((l) => l.includes("test(text)") && l.includes("return null") && l.includes("[0-9"));

  it("is still where this test thinks it is", () => {
    /* Negative control on the instrument: a rename or a refactor must fail the
     * suite loudly rather than leave every assertion below testing `undefined`. */
    expect(line, "the folio-literal guard was not found in pagination.jsx").toBeTruthy();
  });

  const extracted = /\/(\^\[[^/]+\]\+\$)\//u.exec(line ?? "")?.[1];

  it("yields a class this test can actually compile", () => {
    expect(extracted, `could not extract the class from: ${line}`).toBeTruthy();
  });

  /*
   * NO `u` FLAG — AND THAT IS THE POINT, NOT AN OVERSIGHT.
   *
   * ExtendScript is ES3: it has no `u` flag, so InDesign evaluates this class
   * under Annex B's lenient rules, where a dangling `-` after a consumed range
   * operand is accepted as a literal and the class simply comes out narrower.
   * Modern V8 with `u` REJECTS the same text outright ("Invalid character
   * class"). Compiling it here with `u` would therefore test semantics InDesign
   * never uses: the broken form would throw at collection instead of quietly
   * failing to match, and this file would report a crash where production
   * reports a wrong answer. Annex B tolerance is exactly why the defect could
   * live in a shipped file at all.
   */
  const re = new RegExp(extracted ?? "^$");

  /* Every dash in the U+2010–U+2015 block. The point of the range is that it
   * covers all of them; naming them one by one is what makes a silent narrowing
   * visible. */
  const DASHES: [string, string][] = [
    ["U+2010 hyphen", "‐"],
    ["U+2011 non-breaking hyphen", "‑"],
    ["U+2012 figure dash", "‒"],
    ["U+2013 en dash", "–"],
    ["U+2014 em dash", "—"],
    ["U+2015 horizontal bar", "―"],
  ];

  it.each(DASHES)("treats a folio range joined by %s as a folio", (_name, dash) => {
    expect(re.test(`8${dash}9`)).toBe(true);
  });

  it("catches the en dash specifically — the publisher's range dash, and the case that regressed", () => {
    /* Kept apart from the table above: if the range is ever narrowed again, this
     * is the assertion whose name says what actually breaks in the book. */
    expect(re.test("8–9")).toBe(true);
  });

  it("still accepts the plain forms a folio takes", () => {
    for (const text of ["12", "8-9", "8 – 9", "170 171"]) {
      expect(re.test(text), `${text} is a folio literal and must be filtered out`).toBe(true);
    }
  });

  it("NEGATIVE CONTROL: a real running head is NOT swallowed as a folio", () => {
    /* Without this, a class widened to `.` would pass every assertion above and
     * silence the running-head family completely. */
    for (const text of ["Розділ 3", "Як це працює", "Chapter 2 — beginnings"]) {
      expect(re.test(text), `${text} is a running head, not a folio literal`).toBe(false);
    }
  });
});
