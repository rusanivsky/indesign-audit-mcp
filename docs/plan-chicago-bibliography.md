# Chicago Bibliographic Standard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Chicago Manual of Style as a third bibliographic standard to `bibliography_audit`, and add a `bibliography_apply` write tool.

**Architecture:** A dialect inside the existing pipeline. Chicago gets its own segmenter, parser and rule family; dispatch happens at exactly one place in `collectAudit`. `Finding`, `BibRecord`, `ParsedRecord` and `Zone` are shared verbatim, so `buildReport`, `measureUniformity` and the whole nbsp layer work on Chicago output without being told about it. The write tool reuses the existing `apply_edits` machinery whole.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod for tool schemas, Vitest, ExtendScript (ES3) over the JSX bridge.

**Spec:** [`docs/spec-chicago-bibliography.md`](spec-chicago-bibliography.md)
**Measured facts:** [`docs/measured-facts-chicago.md`](measured-facts-chicago.md)

## Global Constraints

- **`Standard` must stay `"7.1" | "8302"`.** It flows into `DSTU_RULES.check(parsed, standard)`; a third member would hand every ДСТУ rule a value it has no branch for and the miss would be silent. The tool boundary uses a separate wider type.
- **The bibliography directory knows nothing about InDesign.** Every module under `src/bibliography/` works on strings. Bridge calls live in `src/tools/`.
- **`\r` is a paragraph mark; `\n` is a forced line break INSIDE a paragraph.** A rule that treats them alike will not fire on the real document. `H` (`[^\S\r\n]`, `chars.ts`) matches neither.
- **Never commit an edition's identity.** `tests/unit/privacy-gate.test.ts` scans `git ls-files` output — stage a file before trusting a green run. Fixtures reproduce the FORM of real material with substituted proper nouns.
- **Test names and commit messages are Ukrainian**, matching the rest of the repository. Code, comments and docs are English.
- **Every rule carries its CMOS clause in `Finding.basis`.** A verdict without a basis is not reviewable.
- Run gates with `npx vitest run <paths>` and read the output. `&& echo ok` hides failure.

## File Structure

| file | responsibility |
|---|---|
| `src/bibliography/latin.ts` | Latin character classes, the `HN` space class, `hasCyrillic()` |
| `src/bibliography/segment-chicago.ts` | paragraph blocks → Chicago entries |
| `src/bibliography/parse-chicago.ts` | one entry → Chicago zones |
| `src/bibliography/rules-chicago.ts` | the six-rule family + `CHICAGO_RULES` |
| `src/bibliography/types.ts` | MODIFY: `ZoneId` gains four members |
| `src/tools/bibliography.ts` | MODIFY: dispatch, `layers` rename, `bibliography_apply` |

---

### Task 1: Latin classes and the Cyrillic gate

**Files:**
- Create: `src/bibliography/latin.ts`
- Test: `tests/unit/bibliography-latin.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LATIN_UPPER: string`, `LATIN_LOWER: string`, `HN: string`, `hasCyrillic(s: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { hasCyrillic, HN, LATIN_LOWER, LATIN_UPPER } from "../../src/bibliography/latin.js";

describe("latin", () => {
  it("класи латиниці не містять кирилиці", () => {
    expect(new RegExp(`^[${LATIN_UPPER}]+$`, "u").test("ABZ")).toBe(true);
    expect(new RegExp(`^[${LATIN_UPPER}]+$`, "u").test("АБВ")).toBe(false);
    expect(new RegExp(`^[${LATIN_LOWER}]+$`, "u").test("abz")).toBe(true);
  });

  it("HN пропускає примусовий розрив, але НЕ абзац", () => {
    /*
     * Пастка, оплачена 27.08: `\r` — межа абзацу, `\n` — розрив УСЕРЕДИНІ
     * абзацу. Набірник ламає запис руками, і розрив стає між приписною
     * двокрапкою й наступною зоною. Клас, що не пускає `\n`, на живому
     * документі просто не спрацює; клас, що пускає `\r`, зшиє два абзаци.
     */
    const re = new RegExp(`^a${HN}+b$`, "u");
    expect(re.test("a b")).toBe(true);
    expect(re.test("a\nb")).toBe(true);
    expect(re.test("a\rb")).toBe(false);
  });

  it("hasCyrillic бачить одну літеру серед латиниці", () => {
    expect(hasCyrillic("Kyiv")).toBe(false);
    expect(hasCyrillic("Київ")).toBe(true);
    expect(hasCyrillic("ISBN 978, Київ, 2026")).toBe(true);
    expect(hasCyrillic("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/bibliography-latin.test.ts`
Expected: FAIL — `Cannot find module '../../src/bibliography/latin.js'`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Character classes for the Chicago dialect. The counterpart of `chars.ts`,
 * which serves the ДСТУ side: that file's `UK_UPPER` deliberately includes
 * Latin HOMOGLYPHS, because Ukrainian text is typed with them. Chicago
 * material has the opposite need — a class that admits no Cyrillic at all,
 * so an entry opener cannot fire inside a Ukrainian record.
 */

export const LATIN_UPPER = "A-Z";
export const LATIN_LOWER = "a-z";

/**
 * Horizontal space OR a forced line break — but NEVER a paragraph mark.
 *
 * `H` in `chars.ts` is `[^\S\r\n]`: it excludes both. That is right for the
 * ДСТУ index, where records are laid out one per paragraph with no manual
 * breaks. It is wrong here, and the difference is measured, not theoretical:
 * the live CIP record carries a forced line break between the place of
 * publication and the publisher — `City :\nPUBLISHER, 2026.` A rule built on
 * `H` cannot see across it and would silently find nothing.
 *
 * `\r` stays excluded, and for the same reason `segment.ts` stopped
 * substituting it: a mark placed "instead of" a paragraph boundary MERGES two
 * paragraphs.
 */
export const HN = "[^\\S\\r]";

/** Every Cyrillic block, including the supplement — not just U+0400–U+04FF. */
const CYRILLIC = /[Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/u;

export function hasCyrillic(s: string): boolean {
  return CYRILLIC.test(s);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/bibliography-latin.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bibliography/latin.ts tests/unit/bibliography-latin.test.ts
git commit -m "Chicago: класи латиниці, і чому пробіл тут не той, що в ДСТУ"
```

---

### Task 2: The Chicago segmenter

**Files:**
- Create: `src/bibliography/segment-chicago.ts`
- Test: `tests/unit/bibliography-segment-chicago.test.ts`

**Interfaces:**
- Consumes: `LATIN_UPPER`, `LATIN_LOWER`, `HN`, `hasCyrillic` (Task 1); `ContainerSnapshot` from `../corrections/types.js`; `BibRecord`, `SegmentResult`, `SkipReason` from `./types.js`.
- Produces: `segmentChicago(snapshot: ContainerSnapshot, opts?: { recordPattern?: string; recordDiscriminator?: string }): SegmentResult`, `CHICAGO_OPENER: string`, `CHICAGO_DISCRIMINATOR: string`.

**Note on `SkipReason`:** this task adds `"cyrillic"` to the union in `types.ts`. That is the only change to `types.ts` in this task; `ZoneId` is widened in Task 3.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { segmentChicago } from "../../src/bibliography/segment-chicago.js";

const snap = (text: string): ContainerSnapshot => ({
  containerId: "story:245",
  text,
  pageRuns: [{ start: 0, end: text.length + 1, page: "4" }],
  oversetFrom: null,
  isMaster: false,
  kind: "text",
});

/*
 * ФОРМА живого CIP-запису, дослівно — власні назви підмінені, бо ворота
 * приватності забороняють носити тотожність видання, а від імені тут не
 * залежить жодне правило. Зберігається все інше: `\r` між заголовком і
 * описом, примусовий розрив `\n` перед видавцем, `U+0018` замість числа
 * обсягу, пробіл перед двокрапкою й версалка видавця.
 */
const CIP = "Surname Firstname.\rTitle / Firstname Surname. — City :\nPUBLISHER, 2026. —  p.";

describe("segmentChicago", () => {
  it("зшиває заголовок в окремому абзаці з описом у наступному", () => {
    const r = segmentChicago(snap(CIP));
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.text).toBe(CIP);
    expect(r.records[0]?.page).toBe("4");
  });

  it("зріз запису дослівно дорівнює зрізу контейнера", () => {
    /* Контракт, на якому тримаються ВСІ зсуви правил. */
    const s = snap(CIP);
    const r = segmentChicago(s);
    const rec = r.records[0];
    expect(rec).toBeDefined();
    expect(s.text.slice(rec!.start, rec!.end)).toBe(rec!.text);
  });

  it("проза цієї книжки записів НЕ відкриває", () => {
    /*
     * Точна пастка ДСТУ: патерн лише за ознакою відкриття дав 1866 хибних
     * «записів» на цьому ж виданні. Абзаци нижче — з живого документа за
     * формою: друге слово з малої літери, або цифра, або двокрапка.
     */
    const prose =
      "The book covers the practical and psychological sides of pregnancy.\r" +
      "Back home I bought a test almost on autopilot.\r" +
      "Format 70×100/12. Offset printing.\r" +
      "Paper: Munken Print White, 150 g/m2\r" +
      "Created by the publisher PUBLISHER, editor in chief: Name Surname.";
    const r = segmentChicago(snap(prose));
    expect(r.records).toEqual([]);
  });

  it("відкривач без розрізняльника — не запис", () => {
    const r = segmentChicago(snap("Surname Firstname.\r\rAnother Paragraph here."));
    expect(r.records).toEqual([]);
    expect(r.skipped.some((s) => s.reason === "no-discriminator")).toBe(true);
  });

  it("кириличний запис не відкривається взагалі", () => {
    const uk = "Прізвище Ім'я.\rНазва / Ім'я Прізвище. — Київ : ВИДАВЕЦЬ, 2026. — 196 с.";
    const r = segmentChicago(snap(uk));
    expect(r.records).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toContain("cyrillic");
  });

  it("три-емний тире відкриває запис повторюваного автора", () => {
    const repeated = "———. Another Title. City: Publisher, 2019.";
    const r = segmentChicago(snap(repeated));
    expect(r.records).toHaveLength(1);
  });

  it("майстер-сторінки не сегментуються", () => {
    const r = segmentChicago({ ...snap(CIP), isMaster: true });
    expect(r.records).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/bibliography-segment-chicago.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Widen `SkipReason`**

In `src/bibliography/types.ts`, change:

```ts
export type SkipReason = "heading" | "cross-reference" | "no-discriminator";
```

to:

```ts
export type SkipReason = "heading" | "cross-reference" | "no-discriminator" | "cyrillic";
```

- [ ] **Step 4: Write the implementation**

```ts
import { hasCyrillic, HN, LATIN_LOWER, LATIN_UPPER } from "./latin.js";
import type { BibRecord, SegmentResult, SkippedParagraph } from "./types.js";
import type { ContainerSnapshot } from "../corrections/types.js";

/**
 * A Chicago entry is ONE paragraph — bibliographies set entries with a
 * hanging indent, so continuation lines are soft wraps, not paragraphs. That
 * is the opposite of the ДСТУ index, where block-based segmentation was
 * required (`segment.ts`).
 *
 * One exception is measured, not assumed: the CIP block of a translated
 * edition puts its heading on its own paragraph. So a paragraph carrying an
 * opener stays OPEN and absorbs the paragraphs after it, exactly as a
 * numbered record does on the ДСТУ side — only the thing that opens it
 * differs.
 */

/**
 * What may OPEN an entry: an inverted personal name, or Chicago's 3-em dash
 * standing for a repeated author.
 *
 * The second token must be capitalised, and that single condition is what
 * keeps prose out. Measured against the live edition: «Back home I bought…»,
 * «The book covers…», «Created by the publisher…», «Signed to press…» all
 * have a lowercase second word; «Format 70×100/12» has a digit; «Paper:
 * Munken…» has a colon; every running head is all-caps and has no lowercase
 * tail. None of them opens.
 */
export const CHICAGO_OPENER =
  `^${HN}*(?:———\\.` +
  `|[${LATIN_UPPER}][${LATIN_LOWER}]+(?:[-'’][${LATIN_UPPER}]?[${LATIN_LOWER}]+)*,?${HN}+[${LATIN_UPPER}])`;

/**
 * What makes an opened block an ENTRY rather than a sentence that happens to
 * start with two capitalised words. The opener alone repeats the exact trap
 * ДСТУ hit, where 1866 prose paragraphs qualified.
 *
 * `HN` and not `H` in the place/publisher alternative: the live record breaks
 * the line right there.
 */
export const CHICAGO_DISCRIMINATOR =
  `(?:(?<!\\d)(?:1[5-9]|20)\\d\\d(?!\\d)` + // a year of publication
  `|[${LATIN_UPPER}][${LATIN_LOWER}]+${HN}*:${HN}+[${LATIN_UPPER}]` + // «City: Publisher»
  `|“[^”]+”` + // a quoted article title
  `|https?://)`;

function pageAt(snapshot: ContainerSnapshot, index: number): string {
  for (const run of snapshot.pageRuns) {
    if (index >= run.start && index < run.end) return run.page;
  }
  return snapshot.pageRuns.at(-1)?.page ?? "?";
}

interface OpenBlock {
  start: number;
  end: number;
}

export function segmentChicago(
  snapshot: ContainerSnapshot,
  opts: { recordPattern?: string; recordDiscriminator?: string } = {},
): SegmentResult {
  const records: BibRecord[] = [];
  const skipped: SkippedParagraph[] = [];

  /* Master pages are skipped — the same choice as segment.ts and typography.ts. */
  if (snapshot.isMaster) return { records, skipped, numberingGaps: [] };

  const openerRe = new RegExp(opts.recordPattern ?? CHICAGO_OPENER, "u");
  const discriminatorRe = new RegExp(opts.recordDiscriminator ?? CHICAGO_DISCRIMINATOR, "u");

  let open: OpenBlock | null = null;

  const closeOpen = (): void => {
    if (open === null) return;
    const { start, end } = open;
    open = null;

    /*
     * The slice is taken RAW — `\r` stays `\r`. Every rule computes
     * `Finding.start` as `record.start + localOffset` in container
     * coordinates, so `container.text.slice(start, end) === record.text` has
     * to be an identity by construction. `segment.ts` learned this the
     * expensive way: substituting a space for `\r` kept the lengths equal and
     * produced a finding that proposed merging two paragraphs.
     */
    const text = snapshot.text.slice(start, end);

    if (hasCyrillic(text)) {
      /*
       * The language gate, done as a script test rather than a read of
       * InDesign's language attribute. The attribute costs a separate bridge
       * call and, on a localised build, the language-name comparison silently
       * yields zero — the failure mode `typography_audit` carries as
       * `ukrainianRuns`. A script test cannot fail that way.
       *
       * Its reach, named honestly: this stops Chicago from rewriting Ukrainian
       * text. It does NOT make the segmenter safe on an English book whose
       * prose contains years.
       */
      skipped.push({ reason: "cyrillic", text, start });
      return;
    }
    if (!discriminatorRe.test(text)) {
      skipped.push({ reason: "no-discriminator", text, start });
      return;
    }

    records.push({
      /* Chicago entries are unnumbered; the ordinal is the only identifier there is. */
      number: records.length + 1,
      text,
      containerId: snapshot.containerId,
      start,
      end,
      page: pageAt(snapshot, start),
    });
  };

  let offset = 0;
  for (const para of snapshot.text.split("\r")) {
    const start = offset;
    const end = start + para.length;
    offset = end + 1; // +1 — the \r that split ate

    if (para.trim() === "") {
      closeOpen();
      continue;
    }
    if (openerRe.test(para)) {
      closeOpen();
      open = { start, end };
      continue;
    }
    if (open !== null) {
      open.end = end;
    } else {
      skipped.push({ reason: "heading", text: para, start });
    }
  }
  closeOpen();

  return { records, skipped, numberingGaps: [] };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/bibliography-segment-chicago.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the full ДСТУ suite — nothing there may move**

Run: `npx vitest run tests/unit/bibliography-segment.test.ts tests/unit/bibliography-tool.test.ts`
Expected: PASS. `SkipReason` grew a member; if any exhaustive `switch` over it exists, this is where it surfaces.

- [ ] **Step 7: Commit**

```bash
git add src/bibliography/segment-chicago.ts src/bibliography/types.ts tests/unit/bibliography-segment-chicago.test.ts
git commit -m "Chicago: сегментатор без номерів, і проза цієї книжки як негативний доказ"
```

---

### Task 3: The Chicago parser

**Files:**
- Create: `src/bibliography/parse-chicago.ts`
- Modify: `src/bibliography/types.ts` — `ZoneId`
- Test: `tests/unit/bibliography-parse-chicago.test.ts`

**Interfaces:**
- Consumes: `BibRecord`, `ParsedRecord`, `Zone`, `ZoneId` from `./types.js`; `HN`, `LATIN_UPPER`, `LATIN_LOWER` (Task 1).
- Produces: `parseChicago(record: BibRecord): ParsedRecord`.

- [ ] **Step 1: Widen `ZoneId`**

In `src/bibliography/types.ts`:

```ts
export type ZoneId =
  | "heading"
  | "title"
  | "subtitle"
  | "responsibility"
  | "source"
  | "imprint"
  | "extent"
  | "notes"
  | "place"
  | "publisher"
  | "year"
  | "url";
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { BibRecord } from "../../src/bibliography/types.js";
import { parseChicago } from "../../src/bibliography/parse-chicago.js";

const CIP = "Surname Firstname.\rTitle / Firstname Surname. — City :\nPUBLISHER, 2026. —  p.";

const rec = (text: string): BibRecord => ({
  number: 1,
  text,
  containerId: "story:245",
  start: 0,
  end: text.length,
  page: "4",
});

const zone = (text: string, id: string): string | undefined =>
  parseChicago(rec(text)).zones.find((z) => z.id === id)?.text;

describe("parseChicago", () => {
  it("розбирає живу форму CIP-запису на зони", () => {
    const p = parseChicago(rec(CIP));
    expect(p.unparsed).toBeNull();
    expect(p.zones.find((z) => z.id === "heading")?.text).toBe("Surname Firstname.");
    expect(p.zones.find((z) => z.id === "title")?.text).toBe("Title");
    expect(p.zones.find((z) => z.id === "place")?.text).toBe("City");
    expect(p.zones.find((z) => z.id === "publisher")?.text).toBe("PUBLISHER");
    expect(p.zones.find((z) => z.id === "year")?.text).toBe("2026");
  });

  it("РОЗБИРАЧ НЕ СУДДЯ: бачить зону навіть із неправильною пунктуацією", () => {
    /*
     * `City :` з пробілом перед двокрапкою — саме те, на що поскаржиться
     * правило. Якби розбирач приймав лише правильну форму, правилу не було б
     * на що показати.
     */
    expect(zone(CIP, "place")).toBe("City");
    const correct = "Surname, Firstname. Title. City: Publisher, 2026.";
    expect(zone(correct, "place")).toBe("City");
  });

  it("зсуви зон — у координатах ТЕКСТУ ЗАПИСУ", () => {
    const p = parseChicago(rec(CIP));
    for (const z of p.zones) expect(CIP.slice(z.start, z.end)).toBe(z.text);
  });

  it("абзац без жодного приписного знака лишається нерозібраним", () => {
    const p = parseChicago(rec("Surname Firstname and some words with no marks at all"));
    expect(p.unparsed).not.toBeNull();
    expect(p.zones).toEqual([]);
  });

  it("тримає обсяг як окрему зону, разом із маркером номера сторінки", () => {
    expect(zone(CIP, "extent")).toBe(" p.");
  });

  it("бачить URL як зону", () => {
    const withUrl = "Surname, Firstname. Title. City: Publisher, 2026. https://example.org/x.";
    expect(zone(withUrl, "url")).toBe("https://example.org/x");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/unit/bibliography-parse-chicago.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
/**
 * Parses ONE Chicago entry into zones.
 *
 * Boundary of responsibility, inherited from `parse.ts` and restated because
 * it is the rule most easily broken: THE PARSER IS NOT A JUDGE. It must
 * recognise `City :` as the place zone even though the space before the colon
 * is exactly what `chicago-colon-spacing` exists to complain about. A parser
 * that accepted only correct punctuation would leave every rule with nothing
 * to point at.
 */

import { HN, LATIN_LOWER, LATIN_UPPER } from "./latin.js";
import type { BibRecord, ParsedRecord, Zone, ZoneId } from "./types.js";

/** The heading: everything up to the first period that ends the name part. */
const HEADING = new RegExp(
  `^${HN}*((?:———` +
    `|[${LATIN_UPPER}][${LATIN_LOWER}]+(?:[-'’][${LATIN_UPPER}]?[${LATIN_LOWER}]+)*` +
    `,?${HN}+[${LATIN_UPPER}][${LATIN_LOWER}.]*)\\.)`,
  "u",
);

/** Place and publisher, in either the correct or the ГОСТ spelling of the colon. */
const IMPRINT = new RegExp(
  `([${LATIN_UPPER}][${LATIN_LOWER}]+)${HN}*:${HN}*` + // place, colon spelled either way
    `([${LATIN_UPPER}][${LATIN_UPPER}${LATIN_LOWER}${HN}.,&'’-]*?)` + // publisher
    `,${HN}*((?:1[5-9]|20)\\d\\d)`, // year
  "u",
);

const URL_RE = /https?:\/\/[^\s”)]+/u;
/** An extent zone: a page count, or the page-number MARKER a CIP block uses. */
const EXTENT = new RegExp(`(?:\\d+|)${HN}*(?:p\\.|pp\\.|pages)`, "u");

function push(zones: Zone[], id: ZoneId, text: string, start: number): void {
  if (text.trim() === "") return;
  zones.push({ id, start, end: start + text.length, text });
}

export function parseChicago(record: BibRecord): ParsedRecord {
  const text = record.text;
  const zones: Zone[] = [];

  let cursor = 0;
  const heading = HEADING.exec(text);
  if (heading?.[1] !== undefined) {
    const at = text.indexOf(heading[1]);
    push(zones, "heading", heading[1], at);
    cursor = at + heading[1].length;
  }

  const imprint = IMPRINT.exec(text);
  const imprintAt = imprint?.index ?? -1;

  /*
   * The title runs from the end of the heading to the imprint, minus a
   * statement of responsibility if the ГОСТ ` / ` repeat is present. Chicago
   * has no such zone, which is precisely why the rule that removes it needs
   * the parser to mark it.
   */
  const headEnd = imprintAt === -1 ? text.length : imprintAt;
  const head = text.slice(cursor, headEnd);
  const respAt = head.indexOf(" / ");
  const titlePart = respAt === -1 ? head : head.slice(0, respAt);

  /* Trim the ГОСТ zone separator and stray punctuation off the title's tail. */
  const titleTrimmed = titlePart.replace(/[\s.–—]+$/u, "");
  push(zones, "title", titleTrimmed, cursor + titlePart.indexOf(titleTrimmed));
  if (respAt !== -1) {
    push(zones, "responsibility", head.slice(respAt), cursor + respAt);
  }

  if (imprint !== null && imprintAt !== -1) {
    const place = imprint[1] ?? "";
    const publisher = (imprint[2] ?? "").replace(/[\s,]+$/u, "");
    const year = imprint[3] ?? "";
    push(zones, "place", place, imprintAt);
    push(zones, "publisher", publisher, text.indexOf(publisher, imprintAt + place.length));
    push(zones, "year", year, text.indexOf(year, imprintAt));
  }

  const extent = EXTENT.exec(text);
  if (extent !== null) push(zones, "extent", extent[0], extent.index);

  const url = URL_RE.exec(text);
  if (url !== null) push(zones, "url", url[0], url.index);

  /*
   * A paragraph can consist of words and nothing else; calling that a "title"
   * would be a fabrication rather than a recognised zone. The same guard
   * `parse.ts` carries, for the same reason.
   */
  const hasPrescribed = imprintAt !== -1 || respAt !== -1 || url !== null;
  const unparsed = !hasPrescribed
    ? "no prescribed punctuation mark found"
    : zones.find((z) => z.id === "title") === undefined
      ? "no main title found"
      : null;

  return { record, zones: unparsed === null ? zones : [], unparsed };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/bibliography-parse-chicago.test.ts`
Expected: PASS, 6 tests. If the `title` offset assertion fails, the cause is `indexOf` on a trimmed substring — fix by computing the offset arithmetically rather than searching.

- [ ] **Step 6: Commit**

```bash
git add src/bibliography/parse-chicago.ts src/bibliography/types.ts tests/unit/bibliography-parse-chicago.test.ts
git commit -m "Chicago: розбирач зон, який навмисне не суддя"
```

---

### Task 4: The four high-confidence rules

**Files:**
- Create: `src/bibliography/rules-chicago.ts`
- Test: `tests/unit/bibliography-rules-chicago.test.ts`

**Interfaces:**
- Consumes: `parseChicago` (Task 3); `Finding`, `ParsedRecord` from `./types.js`.
- Produces: `ChicagoRule` (`{ id, title, basis, check(parsed: ParsedRecord): Finding[] }`), `CHICAGO_RULES: ChicagoRule[]`, and the named rules `headingCommaRule`, `zoneSeparatorRule`, `colonSpacingRule`, `responsibilityRepeatRule`.

**Note:** `ChicagoRule.check` takes ONE argument. `BibRule.check` takes `(parsed, standard)` because ДСТУ's two standards disagree about the separator. Chicago is one standard, so a second parameter would be a lie about the interface.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { BibRecord } from "../../src/bibliography/types.js";
import { parseChicago } from "../../src/bibliography/parse-chicago.js";
import { CHICAGO_RULES } from "../../src/bibliography/rules-chicago.js";

const CIP = "Surname Firstname.\rTitle / Firstname Surname. — City :\nPUBLISHER, 2026. —  p.";
const CORRECT = "Surname, Firstname. Title. City: Publisher, 2026.";

const rec = (text: string): BibRecord => ({
  number: 1,
  text,
  containerId: "story:245",
  start: 100,
  end: 100 + text.length,
  page: "4",
});

const run = (text: string, id: string) =>
  CHICAGO_RULES.filter((r) => r.id === id).flatMap((r) => r.check(parseChicago(rec(text))));

describe("правила Chicago, високої певності", () => {
  it("chicago-heading-comma: інверсоване ім'я вимагає коми", () => {
    const f = run(CIP, "chicago-heading-comma");
    expect(f).toHaveLength(1);
    expect(f[0]?.before).toBe("Surname Firstname");
    expect(f[0]?.suggested).toBe("Surname, Firstname");
    expect(f[0]?.confidence).toBe("high");
  });

  it("chicago-zone-separator: « . — » стає крапкою з пробілом", () => {
    const f = run(CIP, "chicago-zone-separator");
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f.every((x) => x.suggested === ". ")).toBe(true);
  });

  it("chicago-colon-spacing: пробіл перед двокрапкою прибрано", () => {
    const f = run(CIP, "chicago-colon-spacing");
    expect(f).toHaveLength(1);
    expect(f[0]?.before).toBe(" :");
    expect(f[0]?.suggested).toBe(":");
  });

  it("chicago-responsibility-repeat: повтор автора видаляється", () => {
    const f = run(CIP, "chicago-responsibility-repeat");
    expect(f).toHaveLength(1);
    expect(f[0]?.suggested).toBe("");
  });

  it("ЖОДНЕ правило не спрацьовує на вже правильному записі", () => {
    const all = CHICAGO_RULES.flatMap((r) => r.check(parseChicago(rec(CORRECT))));
    expect(all.map((f) => f.ruleId)).toEqual([]);
  });

  it("зсуви — у координатах КОНТЕЙНЕРА, і зріз збігається з before", () => {
    const container = "x".repeat(100) + CIP;
    for (const f of CHICAGO_RULES.flatMap((r) => r.check(parseChicago(rec(CIP))))) {
      expect(container.slice(f.start, f.end)).toBe(f.before);
    }
  });

  it("кожне правило називає підставу", () => {
    for (const r of CHICAGO_RULES) expect(r.basis).toMatch(/CMOS/u);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/bibliography-rules-chicago.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The Chicago Manual of Style bibliography-entry rules.
 *
 * Chicago is ONE standard, so `check` takes one argument. The ДСТУ family
 * takes a second because 7.1 and 8302 disagree about the very mark 7.1
 * prescribes; inventing that parameter here would describe a choice that does
 * not exist.
 */

import { HN } from "./latin.js";
import type { Confidence, Finding, ParsedRecord } from "./types.js";

export interface ChicagoRule {
  id: string;
  title: string;
  basis: string;
  check(parsed: ParsedRecord): Finding[];
}

const CONTEXT = 40;

function finding(
  rule: Pick<ChicagoRule, "id" | "title" | "basis">,
  parsed: ParsedRecord,
  localStart: number,
  localEnd: number,
  suggested: string,
  confidence: Confidence = "high",
): Finding {
  const { record } = parsed;
  const zone = parsed.zones.find((z) => localStart >= z.start && localStart < z.end);
  return {
    ruleId: rule.id,
    title: rule.title,
    confidence,
    recordNumber: record.number,
    containerId: record.containerId,
    page: record.page,
    zone: zone?.id ?? null,
    /* Container coordinates — a finding must be showable in the document. */
    start: record.start + localStart,
    end: record.start + localEnd,
    before: record.text.slice(localStart, localEnd),
    suggested,
    contextBefore: record.text.slice(Math.max(0, localStart - CONTEXT), localStart),
    contextAfter: record.text.slice(localEnd, localEnd + CONTEXT),
    basis: rule.basis,
  };
}

export const headingCommaRule: ChicagoRule = {
  id: "chicago-heading-comma",
  title: "Comma in an inverted name",
  basis: "CMOS 18, 13.3: in a bibliography the first author's name is inverted — surname, comma, given name",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const heading = parsed.zones.find((z) => z.id === "heading");
    if (heading === undefined) return [];
    const m = new RegExp(`^([A-Za-z'’-]+)(${HN}+)([A-Z])`, "u").exec(heading.text);
    if (m === null) return [];
    const surname = m[1] ?? "";
    const gap = m[2] ?? "";
    const given = m[3] ?? "";
    /* Already correct — the surname ends with a comma. */
    if (surname.endsWith(",")) return [];
    const localStart = heading.start;
    const localEnd = heading.start + surname.length + gap.length + given.length;
    return [
      finding(this, parsed, localStart, localEnd, `${surname}, ${given}`),
    ];
  },
};

/**
 * The ГОСТ zone separator « . — » (period, space, dash, space) in any dash
 * spelling. Chicago separates zones with a period and a single space.
 *
 * Both spaces are mandatory in the pattern, for the reason `rules-dstu.ts`
 * records: without them the rule catches abbreviations.
 */
const GOST_SEPARATOR = new RegExp(`\\.${HN}[‐-―−]${HN}`, "gu");

export const zoneSeparatorRule: ChicagoRule = {
  id: "chicago-zone-separator",
  title: "Zone separator",
  basis: "CMOS 18, 14.1: bibliography entry elements are separated by periods, not by the period-dash of ГОСТ",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const re = GOST_SEPARATOR;
    re.lastIndex = 0;
    const out: Finding[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(parsed.record.text)) !== null) {
      out.push(finding(this, parsed, m.index, m.index + m[0].length, ". "));
    }
    return out;
  },
};

export const colonSpacingRule: ChicagoRule = {
  id: "chicago-colon-spacing",
  title: "Space before the imprint colon",
  basis: "CMOS 18, 14.30: place and publisher are joined as «Place: Publisher» — no space before the colon",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const place = parsed.zones.find((z) => z.id === "place");
    if (place === undefined) return [];
    const after = parsed.record.text.slice(place.end);
    const m = new RegExp(`^(${HN}+):`, "u").exec(after);
    if (m === null) return [];
    return [finding(this, parsed, place.end, place.end + (m[1] ?? "").length + 1, ":")];
  },
};

export const responsibilityRepeatRule: ChicagoRule = {
  id: "chicago-responsibility-repeat",
  title: "Author repeated after a slash",
  basis: "CMOS 18, 14.1: Chicago has no statement-of-responsibility zone; the author appears once, in the heading",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const resp = parsed.zones.find((z) => z.id === "responsibility");
    if (resp === undefined) return [];
    return [finding(this, parsed, resp.start, resp.end, "")];
  },
};

export const CHICAGO_RULES: ChicagoRule[] = [
  headingCommaRule,
  zoneSeparatorRule,
  colonSpacingRule,
  responsibilityRepeatRule,
];
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/bibliography-rules-chicago.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bibliography/rules-chicago.ts tests/unit/bibliography-rules-chicago.test.ts
git commit -m "Chicago: чотири правила високої певності, кожне з підставою CMOS"
```

---

### Task 5: The two needs-review rules

**Files:**
- Modify: `src/bibliography/rules-chicago.ts`
- Test: `tests/unit/bibliography-rules-chicago-review.test.ts`

**Interfaces:**
- Consumes: `ChicagoRule`, `finding` (Task 4 — export `finding` from the module for this task).
- Produces: `extentRule`, `publisherCapsRule`, both appended to `CHICAGO_RULES`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { BibRecord } from "../../src/bibliography/types.js";
import { parseChicago } from "../../src/bibliography/parse-chicago.js";
import { CHICAGO_RULES } from "../../src/bibliography/rules-chicago.js";

const CIP = "Surname Firstname.\rTitle / Firstname Surname. — City :\nPUBLISHER, 2026. —  p.";

const rec = (text: string): BibRecord => ({
  number: 1,
  text,
  containerId: "story:245",
  start: 0,
  end: text.length,
  page: "4",
});

const run = (text: string, id: string) =>
  CHICAGO_RULES.filter((r) => r.id === id).flatMap((r) => r.check(parseChicago(rec(text))));

describe("правила Chicago, що потребують рішення людини", () => {
  it("chicago-extent НІКОЛИ не буває high", () => {
    /*
     * Chicago не має зони обсягу, але CIP-блок її законно має, і тут значення
     * навіть не число: це маркер номера сторінки U+0018, який складається у
     * «196». Видалити його автоматично означає знищити живий маркер.
     */
    const f = run(CIP, "chicago-extent");
    expect(f).toHaveLength(1);
    expect(f[0]?.confidence).toBe("needs-review");
    expect(f[0]?.before).toContain("");
  });

  it("chicago-publisher-caps НІКОЛИ не буває high", () => {
    /*
     * Ворота «зразок ≠ ужиток». У копірайті поруч стоїть «© 2026 PUBLISHER™»
     * — це власна форма назви видавництва, а не хиба набору. Правило, яке не
     * відрізняє зразка від ужитку, — саме та вада, що її Фаза 14 знайшла у
     * двох детекторів із п'яти й що пройшла повз сім рецензій.
     */
    const f = run(CIP, "chicago-publisher-caps");
    expect(f).toHaveLength(1);
    expect(f[0]?.confidence).toBe("needs-review");
    expect(f[0]?.suggested).toBe("Publisher");
  });

  it("видавець із однією великою літерою не є знахідкою", () => {
    const ok = "Surname, Firstname. Title. City: Publisher, 2026.";
    expect(run(ok, "chicago-publisher-caps")).toEqual([]);
  });

  it("абревіатура у назві видавця не робить її версалкою", () => {
    /* «MIT Press» — дві великі літери підряд у слові, але не весь рядок. */
    const mit = "Surname, Firstname. Title. City: MIT Press, 2026.";
    expect(run(mit, "chicago-publisher-caps")).toEqual([]);
  });

  it("жодне needs-review правило не потрапляє в набір high", () => {
    const all = CHICAGO_RULES.flatMap((r) => r.check(parseChicago(rec(CIP))));
    const review = all.filter((f) => f.confidence === "needs-review").map((f) => f.ruleId).sort();
    expect(review).toEqual(["chicago-extent", "chicago-publisher-caps"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/bibliography-rules-chicago-review.test.ts`
Expected: FAIL — no findings, the rules do not exist yet.

- [ ] **Step 3: Write the implementation**

Append to `src/bibliography/rules-chicago.ts`, and change `finding`'s declaration to `export function finding(`:

```ts
export const extentRule: ChicagoRule = {
  id: "chicago-extent",
  title: "Page extent in a bibliography entry",
  basis: "CMOS 18, 14.1: a bibliography entry ends with the year; total pagination is not given",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const extent = parsed.zones.find((z) => z.id === "extent");
    if (extent === undefined) return [];
    /*
     * needs-review, never high, and the reason is measured: a CIP block
     * legitimately carries the extent, and in the live record the value is not
     * a literal at all — it is U+0018, InDesign's page-number marker, which
     * composes to the last page number. Deleting it automatically destroys a
     * live marker and silently replaces a computed number with nothing.
     */
    return [finding(this, parsed, extent.start, extent.end, "", "needs-review")];
  },
};

/** Full caps means: at least two letters, and NOT ONE of them lowercase. */
const ALL_CAPS_WORD = /^[A-Z][A-Z’'&.-]*$/u;

function titleCase(s: string): string {
  return s
    .split(/(\s+)/u)
    .map((w) => (/^\s+$/u.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join("");
}

export const publisherCapsRule: ChicagoRule = {
  id: "chicago-publisher-caps",
  title: "Publisher name in full caps",
  basis: "CMOS 18, 14.32: publishers' names are given in headline style, not in the capitalisation of a logo",
  check(parsed) {
    if (parsed.unparsed !== null) return [];
    const publisher = parsed.zones.find((z) => z.id === "publisher");
    if (publisher === undefined) return [];
    const words = publisher.text.split(/\s+/u).filter((w) => w !== "");
    if (words.length === 0) return [];
    /*
     * EVERY word must be all-caps. One all-caps word among ordinary ones is an
     * abbreviation («MIT Press»), not a house style, and proposing to lowercase
     * it would be wrong.
     */
    if (!words.every((w) => ALL_CAPS_WORD.test(w) && w.length > 1)) return [];
    /*
     * needs-review by construction. The copyright block of the same imprint
     * writes the name in exactly this form with a trademark sign: that is the
     * house's own SPECIMEN of its name, not a typesetting slip, and no rule can
     * tell the two apart from the record alone.
     */
    return [
      finding(this, parsed, publisher.start, publisher.end, titleCase(publisher.text), "needs-review"),
    ];
  },
};
```

Then extend the export:

```ts
export const CHICAGO_RULES: ChicagoRule[] = [
  headingCommaRule,
  zoneSeparatorRule,
  colonSpacingRule,
  responsibilityRepeatRule,
  extentRule,
  publisherCapsRule,
];
```

- [ ] **Step 4: Run both rule suites and watch them pass**

Run: `npx vitest run tests/unit/bibliography-rules-chicago.test.ts tests/unit/bibliography-rules-chicago-review.test.ts`
Expected: PASS. The Task 4 test «ЖОДНЕ правило не спрацьовує на вже правильному записі» must still pass — if `chicago-extent` now fires on `CORRECT`, the extent pattern is matching something it should not.

- [ ] **Step 5: Commit**

```bash
git add src/bibliography/rules-chicago.ts tests/unit/bibliography-rules-chicago-review.test.ts
git commit -m "Chicago: два правила, що не сміють бути high, і ворота «зразок ≠ ужиток»"
```

---

### Task 6: Dispatch, the `layers` rename, and the type gates

**Files:**
- Modify: `src/tools/bibliography.ts`
- Test: `tests/unit/bibliography-chicago-dispatch.test.ts`

**Interfaces:**
- Consumes: `segmentChicago` (Task 2), `parseChicago` (Task 3), `CHICAGO_RULES` (Tasks 4–5).
- Produces: `AuditStandard = Standard | "chicago"`; `Layer = "standard" | "nbsp"`; `normaliseLayers(input: string[]): Layer[]`; `assertKnownRules(standard: AuditStandard, ruleIds: string[]): void`; `collectAudit` accepting `standard: AuditStandard`.

**Rename in this task:** `AuditCollection.standardFindings` becomes
`standardFindings`. It now carries Chicago findings too, and a field named
after one standard while holding another's output is the same defect the
`layers` rename fixes — a name that lies. Update every reference; the
compiler will list them.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ContainerSnapshot } from "../../src/corrections/types.js";
import { collectAudit, normaliseLayers } from "../../src/tools/bibliography.js";
import { DSTU_RULES } from "../../src/bibliography/rules-dstu.js";
import { CHICAGO_RULES } from "../../src/bibliography/rules-chicago.js";

const CIP = "Surname Firstname.\rTitle / Firstname Surname. — City :\nPUBLISHER, 2026. —  p.";

const snap = (text: string): ContainerSnapshot => ({
  containerId: "story:245",
  text,
  pageRuns: [{ start: 0, end: text.length + 1, page: "4" }],
  oversetFrom: null,
  isMaster: false,
  kind: "text",
});

describe("диспетч стандарту", () => {
  it("chicago знаходить запис там, де ДСТУ не знаходить жодного", () => {
    const dstu = collectAudit([snap(CIP)], { standard: "7.1", layers: ["standard"] });
    expect(dstu.records).toBe(0);
    const chicago = collectAudit([snap(CIP)], { standard: "chicago", layers: ["standard"] });
    expect(chicago.records).toBe(1);
  });

  it("під chicago НЕ спрацьовує жодне правило ДСТУ", () => {
    const r = collectAudit([snap(CIP)], { standard: "chicago", layers: ["standard"] });
    const dstuIds = new Set(DSTU_RULES.map((x) => x.id));
    expect(r.standardFindings.filter((f) => dstuIds.has(f.ruleId))).toEqual([]);
    expect(r.standardFindings.length).toBeGreaterThan(0);
    expect(r.standardFindings.every((f) => CHICAGO_RULES.some((c) => c.id === f.ruleId))).toBe(true);
  });

  it("ruleIds звужує родину Chicago, а не мовчки віддає всю", () => {
    const r = collectAudit([snap(CIP)], {
      standard: "chicago",
      layers: ["standard"],
      ruleIds: ["chicago-colon-spacing"],
    });
    expect(new Set(r.standardFindings.map((f) => f.ruleId))).toEqual(new Set(["chicago-colon-spacing"]));
  });

  it("«dstu» лишається застарілим синонімом «standard»", () => {
    expect(normaliseLayers(["dstu", "nbsp"])).toEqual(["standard", "nbsp"]);
    expect(normaliseLayers(["standard"])).toEqual(["standard"]);
    expect(normaliseLayers(["nbsp"])).toEqual(["nbsp"]);
  });

  it("ВОРОТА: Standard лишається рівно двочленним", () => {
    /*
     * Тип не можна перевірити під час виконання, тож перевіряємо його
     * єдиного споживача: кожне правило ДСТУ мусить приймати обидва значення
     * і не мусить знати про третє. Якби union розрісся, `check` дістав би
     * значення без гілки — і промах був би тихим.
     */
    const values: Array<"7.1" | "8302"> = ["7.1", "8302"];
    expect(values).toHaveLength(2);
    for (const r of DSTU_RULES) expect(r.check.length).toBe(2);
    for (const c of CHICAGO_RULES) expect(c.check.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/bibliography-chicago-dispatch.test.ts`
Expected: FAIL — `normaliseLayers` is not exported and `standard: "chicago"` does not typecheck.

- [ ] **Step 3: Change the types and the dispatch**

In `src/tools/bibliography.ts`, replace the `Layer` type and add the wider standard:

```ts
import { segmentChicago } from "../bibliography/segment-chicago.js";
import { parseChicago } from "../bibliography/parse-chicago.js";
import { CHICAGO_RULES } from "../bibliography/rules-chicago.js";

/**
 * `standard` names the standard; `layers` names the layers. Until now the
 * enum mixed the two (`"dstu"` is a standard, `"nbsp"` is a layer), which was
 * merely untidy with two standards and becomes a representable contradiction
 * with three: `standard: "chicago", layers: ["dstu"]`. `"dstu"` stays accepted
 * as a deprecated alias so existing calls keep working.
 */
export type Layer = "standard" | "nbsp";

export function normaliseLayers(input: string[]): Layer[] {
  return input.map((l) => (l === "dstu" ? "standard" : l)) as Layer[];
}

/**
 * The tool boundary is wider than `Standard`, and deliberately so: `Standard`
 * feeds `DSTU_RULES.check`, and a third member there would hand every ДСТУ
 * rule a value it has no branch for. Narrowing below turns that hazard into a
 * compile error instead of a silent `else`.
 */
export type AuditStandard = Standard | "chicago";
```

Then rewrite the body of `collectAudit`:

```ts
export function collectAudit(
  containers: ContainerSnapshot[],
  opts: {
    standard: AuditStandard;
    layers: Layer[];
    ruleIds?: string[];
    recordPattern?: string;
    recordDiscriminator?: string;
  },
): AuditCollection {
  const parsed: ParsedRecord[] = [];
  const skipped: SkippedParagraph[] = [];
  const numberingGaps: Array<{ after: number; next: number }> = [];
  const chicago = opts.standard === "chicago";

  for (const c of containers) {
    const seg = chicago
      ? segmentChicago(c, {
          ...(opts.recordPattern ? { recordPattern: opts.recordPattern } : {}),
          ...(opts.recordDiscriminator ? { recordDiscriminator: opts.recordDiscriminator } : {}),
        })
      : segmentContainer(c, {
          recordPattern: opts.recordPattern ?? DEFAULT_RECORD_PATTERN,
          recordDiscriminator: opts.recordDiscriminator ?? DEFAULT_RECORD_DISCRIMINATOR,
        });
    skipped.push(...seg.skipped);
    numberingGaps.push(...seg.numberingGaps);
    for (const r of seg.records) parsed.push(chicago ? parseChicago(r) : parseRecord(r));
  }

  const wanted = (id: string): boolean =>
    opts.ruleIds === undefined || opts.ruleIds.includes(id);

  let standardFindings: Finding[] = [];
  if (opts.layers.includes("standard")) {
    if (opts.standard === "chicago") {
      const rules = CHICAGO_RULES.filter((r) => wanted(r.id));
      standardFindings = parsed.flatMap((p) => rules.flatMap((r) => r.check(p)));
    } else {
      /* `opts.standard` is narrowed to `Standard` here BY THE COMPILER — the
       * one place the hazard from the spec is disarmed. */
      const std: Standard = opts.standard;
      const rules = DSTU_RULES.filter((r) => wanted(r.id));
      standardFindings = parsed.flatMap((p) => rules.flatMap((r) => r.check(p, std)));
    }
  }

  const nbspCandidates = opts.layers.includes("nbsp")
    ? collectNbspCandidates(parsed).filter((c) => wanted(c.ruleId))
    : [];

  return {
    records: parsed.length,
    unparsed: parsed.filter((p) => p.unparsed !== null).length,
    parsed,
    skipped,
    numberingGaps,
    standardFindings: standardFindings,
    nbspCandidates,
  };
}
```

- [ ] **Step 4: Update the tool registration**

In `registerBibliographyTools`, change the schema and the handler:

```ts
        standard: z
          .enum(["7.1", "8302", "chicago"])
          .default("7.1")
          .describe(
            "7.1 — a Ukrainian index and bibliography; 8302 — a Ukrainian list of sources in an " +
              "academic work; chicago — the Chicago Manual of Style bibliography-entry form for " +
              "English-language material.",
          ),
        layers: z
          .array(z.enum(["standard", "nbsp", "dstu"]))
          .default(["standard", "nbsp"])
          .describe(
            "Which layers of rules to run. \"standard\" is the chosen standard's own family; " +
              "\"dstu\" is a deprecated alias for it.",
          ),
```

and in the handler body, `const layerList = normaliseLayers(layers);`, passing `layerList` into `collectAudit`.

Also update the tool description: the sentence beginning "UKRAINIAN STANDARDS ONLY" is now false and MUST be replaced. Replacement text:

> Three standards: ДСТУ ГОСТ 7.1:2006 and ДСТУ 8302:2015 for Ukrainian material, and the Chicago Manual of Style for English-language material. APA, MLA, ISO 690 and Harvard are NOT implemented — material in those styles run through this tool is judged by the standard you name, which is the wrong answer, not no answer. Chicago has its own segmenter, because a Chicago bibliography is unnumbered and the ДСТУ segmenter opens a record only on a numbered paragraph.

- [ ] **Step 5: Run the dispatch test, the whole bibliography suite, and typecheck**

Run: `npx vitest run tests/unit/bibliography-chicago-dispatch.test.ts`
Expected: PASS, 5 tests.

Run: `npx vitest run tests/unit/bibliography-tool.test.ts tests/integration/bibliography-audit.test.ts`
Expected: PASS — the `layers: ["dstu"]` calls in existing tests must keep working through the alias.

Run: `npm run typecheck`
Expected: 0 errors. If `opts.standard` is reported as not assignable to `Standard`, the narrowing branch was written as `if (chicago)` instead of `if (opts.standard === "chicago")` — the compiler cannot narrow through a boolean variable.

- [ ] **Step 6: Commit**

```bash
git add src/tools/bibliography.ts tests/unit/bibliography-chicago-dispatch.test.ts
git commit -m "Chicago: диспетч за стандартом; layers перестає називати стандарт шаром"
```

---

### Task 7: `bibliography_apply`

**Files:**
- Modify: `src/tools/bibliography.ts`
- Test: `tests/unit/bibliography-apply.test.ts`

**Interfaces:**
- Consumes: `collectAudit`, `normaliseLayers` (Task 6); `toEdits`-style conversion; `runWrite` from `../bridge/envelope.js`; `orderForApply` from `../corrections/planner.js`; `assertExpectedDoc`, `EXPECTED_DOC_NAME_FIELD` from `./shared.js`; `APPLY_TIMEOUT_MS`, `backupStamp`, `withDiffs` from `./corrections.js`; `AcceptedEdit`, `ApplyReport` from `../corrections/types.js`.
- Produces: `bibFindingsToEdits(findings: Finding[]): AcceptedEdit[]`, `assertExpectedRecords(measured: number, requested: number): void`, and the registered `bibliography_apply` tool.

- [ ] **Step 1: Write the failing test**

```ts
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
     * присвоює range.contents. Присвоєння порожнього рядка на "replace" не
     * має прецеденту й ніде не міряне.
     */
    const [e] = bibFindingsToEdits([f({ suggested: "", ruleId: "chicago-extent" })]);
    expect(e?.action).toBe("delete");
    const [r] = bibFindingsToEdits([f({})]);
    expect(r?.action).toBe("replace");
  });

  it("перекриті знахідки не пишуться обидві", () => {
    const edits = bibFindingsToEdits([
      f({ start: 10, end: 20 }),
      f({ start: 15, end: 25, ruleId: "chicago-zone-separator" }),
    ]);
    expect(edits).toHaveLength(1);
  });

  it("expectedOld несе те, що мусить стояти в діапазоні", () => {
    const [e] = bibFindingsToEdits([f({})]);
    expect(e?.expectedOld).toBe(" :");
  });

  it("ВОРОТА: невідоме правило називає себе, а не мовчить", () => {
    /*
     * Фільтр за невідомим id дає порожній список правил, той — нуль знахідок,
     * а нуль знахідок не відрізнити від «документ чистий».
     */
    expect(() => assertKnownRules("chicago", ["chicago-colon-spacing"])) .not.toThrow();
    expect(() => assertKnownRules("chicago", ["bib-zone-separator"])).toThrow(/bib-zone-separator/u);
    expect(() => assertKnownRules("7.1", ["chicago-extent"])).toThrow(/Available/u);
  });

  it("ВОРОТА: інша кількість записів спиняє запис", () => {
    expect(() => assertExpectedRecords(1, 1)).not.toThrow();
    expect(() => assertExpectedRecords(7, 1)).toThrow(/7/u);
    expect(() => assertExpectedRecords(0, 1)).toThrow(/0/u);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/bibliography-apply.test.ts`
Expected: FAIL — neither function is exported.

- [ ] **Step 3: Write the two pure functions**

Add to `src/tools/bibliography.ts`:

```ts
/**
 * Findings → edits. `Finding` already carries container coordinates, so this
 * is a translation, not a computation — the only decisions here are overlap
 * resolution and the delete/replace distinction.
 */
export function bibFindingsToEdits(findings: Finding[]): AcceptedEdit[] {
  const accepted: Finding[] = [];
  const lastEnd = new Map<string, number>();

  for (const f of [...findings].sort(
    (a, b) => a.containerId.localeCompare(b.containerId) || a.start - b.start || b.end - a.end,
  )) {
    if (f.start < (lastEnd.get(f.containerId) ?? -1)) continue;
    accepted.push(f);
    lastEnd.set(f.containerId, f.end);
  }

  return accepted.map((f, i) => ({
    requestId: `bib-${f.ruleId}-${i}`,
    candidateId: `bib-${f.ruleId}-${i}#0`,
    containerId: f.containerId,
    start: f.start,
    end: f.end,
    expectedOld: f.before,
    newText: f.suggested,
    /* An empty replacement is a DELETE, matching corrections/planner.ts and
     * apply.jsx. There is no precedent anywhere for range.contents = "". */
    action: f.suggested === "" ? "delete" : "replace",
  }));
}

/**
 * Spec §8: a rule id that exists in no family must be REPORTED, not silently
 * dropped. Filtering by an unknown id yields an empty rule list, which then
 * yields zero findings — indistinguishable from "the document is clean". The
 * error names what IS available, the way `typography_apply` does.
 */
export function assertKnownRules(standard: AuditStandard, ruleIds: string[]): void {
  const available =
    standard === "chicago" ? CHICAGO_RULES.map((r) => r.id) : DSTU_RULES.map((r) => r.id);
  const unknown = ruleIds.filter((id) => !available.includes(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown rule id(s) for standard ${standard}: ${unknown.join(", ")}. ` +
        `Available: ${available.join(", ")}. Nothing has been changed.`,
    );
  }
}

/**
 * The gate the spec adds because confirmation is BY RULE, not by match.
 *
 * That is sound when a rule's matches are trusted, and dangerous when the
 * segmenter might have opened entries nobody reviewed — which is exactly the
 * risk the Chicago discriminator carries on a book whose prose contains
 * years. Refusing on a count mismatch turns "the document changed under you"
 * from silent edits into a stop.
 */
export function assertExpectedRecords(measured: number, requested: number): void {
  if (measured !== requested) {
    throw new Error(
      `The audit is being applied against ${requested} record(s), but ${measured} were found now. ` +
        `Nothing has been changed. Re-run bibliography_audit and pass the count it reports.`,
    );
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/bibliography-apply.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register the tool**

Inside `registerBibliographyTools`, after the audit registration:

```ts
  server.registerTool(
    "bibliography_apply",
    {
      title: "Applying the bibliographic rules",
      description:
        "Applies the chosen bibliographic rules over the whole document as a single undo step. " +
        "Confirmation is BY RULE, not by individual match: you name ruleIds after reviewing " +
        "bibliography_audit, and the standard must be the same one the audit ran under. " +
        "Doubtful matches (needs-review) are NOT applied by default — to take them too, enable " +
        "includeNeedsReview. Two of the Chicago rules are needs-review by construction: deleting " +
        "the page extent can destroy a live page-number marker, and lowercasing a publisher can " +
        "overwrite the house's own form of its name. " +
        "expectedRecords is mandatory and is checked against the live count before anything is " +
        "written: rule-level confirmation is only safe while the record set is the one you " +
        "reviewed. Before writing it saves a copy of the document in _backups/.",
      inputSchema: {
        ruleIds: z.array(z.string()).min(1).describe("Rules confirmed after the audit."),
        standard: z.enum(["7.1", "8302", "chicago"]).default("7.1"),
        layers: z.array(z.enum(["standard", "nbsp", "dstu"])).default(["standard"]),
        expectedRecords: z
          .number()
          .int()
          .min(0)
          .describe("The record count the audit reported. A mismatch refuses the write."),
        includeNeedsReview: z.boolean().default(false),
        undoName: z.string().default("Bibliographic rules"),
        expectedDocName: EXPECTED_DOC_NAME_FIELD,
      },
    },
    async ({
      ruleIds,
      standard,
      layers,
      expectedRecords,
      includeNeedsReview,
      undoName,
      expectedDocName,
    }) => {
      try {
        const read = await runJsx<{ docName: string; containers: ContainerSnapshot[] }>(
          "containers_read",
          {},
        );
        assertExpectedDoc(read.docName, expectedDocName);
        assertKnownRules(standard, ruleIds);

        const collected = collectAudit(read.containers, {
          standard,
          layers: normaliseLayers(layers),
          ruleIds,
        });
        assertExpectedRecords(collected.records, expectedRecords);

        const chosen = includeNeedsReview
          ? collected.standardFindings
          : collected.standardFindings.filter((f) => f.confidence === "high");
        const edits = bibFindingsToEdits(chosen);
        if (edits.length === 0) {
          return ok({ docName: read.docName, applied: 0, message: "Not a single match to apply." });
        }

        const report = await runWrite<ApplyReport>({
          handler: "apply_edits",
          params: {
            expectedDocName: read.docName,
            stamp: backupStamp(),
            undoName,
            edits: orderForApply(edits),
          },
          timeoutMs: APPLY_TIMEOUT_MS,
        });

        return ok({
          docName: read.docName,
          standard,
          rules: ruleIds,
          records: collected.records,
          matched: collected.standardFindings.length,
          attempted: edits.length,
          skippedNeedsReview: includeNeedsReview
            ? 0
            : collected.standardFindings.length - chosen.length,
          ...withDiffs(report),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );
```

Note: the nbsp layer is excluded from the default `layers` here on purpose — nbsp findings need the `readNoBreak` bridge answers that only the audit path collects, and writing them without that reconciliation is the mismatch `assertNoBreakAnswersMatch` exists to prevent.

- [ ] **Step 6: Typecheck and run the whole suite**

Run: `npm run typecheck`
Expected: 0 errors.

Run: `npx vitest run`
Expected: every test passes. Read the summary line; a `1 failed` inside a long log is easy to scroll past.

- [ ] **Step 7: Commit**

```bash
git add src/tools/bibliography.ts tests/unit/bibliography-apply.test.ts
git commit -m "bibliography_apply: ворота на кількість записів, бо підтвердження йде за правилом"
```

---

### Task 8: Live proof, and the docs that must stop being wrong

**Files:**
- Modify: `docs/measured-facts-chicago.md`
- Modify: `README.md` — the tool table
- Modify: `docs/reference.md` — the bibliography section

**Interfaces:** none; this task produces evidence, not code.

**This task cannot be done alone.** It needs the Ukrainian edition open in InDesign alongside the English one — ask the user to open it. Without it, the claim "Chicago is inert on Ukrainian material" stays unmeasured, and §7 of the measured-facts file says so.

- [ ] **Step 1: Rebuild and restart, then prove the server took the new code**

```bash
npm run build   # in the MAIN checkout, not in a worktree
```

The MCP server loads its modules at startup and never re-reads them. After restarting the client, prove freshness before trusting any number: `bibliography_audit standard=chicago` must return `records: 1`. If it errors on the unknown enum value, the server is still running the old build — stop and restart it.

- [ ] **Step 2: Run the audit on the English print edition and record the result**

Expected: `records: 1`, six findings on `story:245`, four `high` and two `needs-review`, and nothing on `story:243`, `244`, `248`, `249`.

Record the actual output in a new section of `docs/measured-facts-chicago.md`. If it differs from the expectation, the measurement wins — write down what happened and why, and fix the code rather than the expectation.

- [ ] **Step 3: Run the audit on the Ukrainian edition**

Expected: `records: 0`, and skips carrying `reason: "cyrillic"`. Record the counts. This is the only evidence that the gate works on real Cyrillic material rather than on a fixture.

- [ ] **Step 4: Delete §7's "not measured" entries that are now measured**

`docs/measured-facts-chicago.md` §7 currently lists three unmeasured things. Remove the ones this task measured; keep the ones it did not. A stale "not measured" is worse than none — it reads as diligence while being false.

- [ ] **Step 5: Fix the docs that now say something untrue**

`README.md` and `docs/reference.md` both describe `bibliography_audit` as Ukrainian-only, and neither knows `bibliography_apply` exists. Add `bibliography_apply` to the tool table, correct the standard list, and state the `expectedRecords` gate.

Run: `npx vitest run tests/unit/privacy-gate.test.ts`
Expected: PASS — and stage the edited docs first, because the gate reads `git ls-files` and will not see unstaged work.

- [ ] **Step 6: Commit**

```bash
git add docs/measured-facts-chicago.md README.md docs/reference.md
git commit -m "Chicago: доказ на живих виданнях, і документація, що більше не бреше про «лише українські»"
```

---

## Deliberately not in this plan

- **Applying the conversion to the live document.** The plan builds the tool and proves it; running it on the user's edition is their decision and their backup.
- **The `en-dash-parenthetical-us` exception.** It stays untouched. After a conversion its material disappears from the English edition, but it protects the Ukrainian one — the two must not be made to depend on each other.
- **The privacy gate's Latin blind spot.** Real, filed separately; it is not Chicago.
- **A `containerIds` restriction on the audit.** It would make false entries less likely, but the counts are reported and apply is gated on them. It earns its place after a book where the gate proves insufficient.
