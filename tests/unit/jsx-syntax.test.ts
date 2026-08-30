import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Script } from "node:vm";

const JSX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "jsx");

/*
 * A SYNTAX GATE FOR ExtendScript, AND IT DID NOT EXIST WHEN IT WAS NEEDED.
 *
 * The bridge concatenates EVERY file in src/jsx/ into one script, so a syntax
 * error in ANY of them makes EVERY one of the 23 tools fail with the same
 * unhelpful message:
 *
 *     Adobe InDesign 2026 got an error: Syntax error (8)
 *
 * That is exactly what shipped on 2026-08-25. Translating two error messages in
 * `_fixtures.jsx` dropped one quote from each `\""` pair, so the concatenation
 * collapsed into string text and the literal never closed:
 *
 *     was:    "…документ \"" + doc.name + "\", …"
 *     became: "…document \"  + doc.name + \",  …"
 *
 * WHY NOTHING CAUGHT IT. Unit tests never execute ExtendScript, and `tsconfig`
 * does not look at `.jsx` at all. The whole gate set — typecheck exit 0 plus
 * 2673 green unit tests — is blind to this class of defect BY CONSTRUCTION, not
 * by oversight. Only a live integration run against InDesign failed, and that
 * needs InDesign to be running, free of modal dialogs, and several minutes.
 *
 * This test closes the gap in milliseconds and without InDesign: ExtendScript is
 * ES3, which is a subset of the language Node already parses, so compiling each
 * file is enough to prove it parses. It does NOT run the code — `new Script()`
 * only compiles.
 *
 * What this deliberately does NOT check: that the code is valid ES3. Node would
 * happily compile `const`/arrow functions that InDesign rejects at runtime.
 * Catching that needs a real ES3 parser and is a separate job; this test is
 * about the failure that actually happened.
 */
describe("every src/jsx file parses", () => {
  const files = readdirSync(JSX_DIR).filter((f) => f.endsWith(".jsx")).sort();

  it("finds the jsx files at all — otherwise every check below is vacuous", () => {
    /* Negative control on the instrument: a wrong path or a changed extension
     * would leave the loop empty and the suite green on nothing. */
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s compiles", (file) => {
    const source = readFileSync(join(JSX_DIR, file), "utf8");
    expect(() => new Script(source, { filename: file })).not.toThrow();
  });

  /*
   * The concatenation is what the bridge actually sends, and it can fail where
   * the individual files do not: an unterminated block comment or a stray
   * template character in one file swallows the start of the next.
   */
  it("the concatenation of all of them — what the bridge really sends — compiles too", () => {
    const all = files.map((f) => readFileSync(join(JSX_DIR, f), "utf8")).join("\n");
    expect(() => new Script(all, { filename: "bundle.jsx" })).not.toThrow();
  });
});

/*
 * The specific shape that broke it, kept as its own check because the compile
 * test above only fires once the damage makes a file unparseable — and a
 * mangled pair CAN stay parseable while silently producing wrong text.
 */
describe("escaped quotes next to concatenation", () => {
  it("no file has a `\\\" +` or `+ \\\"` sequence — the shape that broke the bridge", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(JSX_DIR).filter((f) => f.endsWith(".jsx"))) {
      const lines = readFileSync(join(JSX_DIR, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/\\" \+ |\+ \\"/u.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders, `a quote is missing from a \\"" pair:\n${offenders.join("\n")}`).toEqual([]);
  });
});
