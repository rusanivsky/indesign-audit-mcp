/**
 * The `folio` family: the folio number against the fact of the page. Pure TypeScript.
 *
 * THE REFERENCE IS DERIVED FROM THE DOCUMENT, NOT SUPPLIED. InDesign itself
 * knows the spread's makeup (`PageRef.spreadSiblings`), so the rule asks
 * nothing and carries over to any book. The tempting constant "left = right
 * minus 1" is forbidden by spec §3: in a book with the folio on verso it
 * would flip.
 */

import type { MarkerDirection } from "./rewrite-types.js";
import { resolveMarkerPage } from "./topology.js";
import type { ClaimFrame, FamilyResult, PageRef, PaginationFinding } from "./types.js";

/**
 * The directions that the frame's OWN MARKERS DECLARE (spec §4.9) — and
 * that's exactly why the detector doesn't need a `range` parameter, and the
 * public `pagination_audit` schema doesn't change.
 *
 * It's tempting to think the detector must know the expected page, and that
 * it depends on the book's convention — a parameter with no default. That's
 * wrong: `PREVIOUS_PAGE_NUMBER` means "the neighbor must sit at N−1" in any
 * edition, and "two pages of the same spread" is something InDesign itself
 * knows (`PageRef.spreadSiblings`). Both sides are derived from the document
 * in full, so `range` stays a parameter ONLY of `pagination_apply`, which
 * needs it to decide which marker to WRITE.
 *
 * BOTH ARE RETURNED, NOT JUST THE FIRST. Until now the function returned
 * "previous" and stopped, and the consequence wasn't "order is arbitrary," as
 * it seemed, but "the second marker's check gets DROPPED": a frame with both
 * `previous` and `next` was checked only against `previous`, and a false
 * `next` produced no finding at all (review probe `14c503b`, case N: `[]`
 * where `next` resolves into a foreign spread). Array order no longer affects
 * anything — all present directions are checked, each with its own finding.
 */
function markerDirections(frame: ClaimFrame): MarkerDirection[] {
  const out: MarkerDirection[] = [];
  for (const p of frame.paragraphs) {
    if (!out.includes("previous") && p.markers.includes("previous-page-number")) out.push("previous");
    if (!out.includes("next") && p.markers.includes("next-page-number")) out.push("next");
  }
  return out;
}

/**
 * Whether the frame carries ANY page-number marker at all.
 *
 * Deliberately wider than `markerDirections`, and the difference here is
 * §4.9 versus the first implementation: the spec defines the dormant-
 * duplicate trigger as "a frame WITH A MARKER on a hidden layer," without
 * narrowing it to a marker of the NEIGHBORING page. The narrowed trigger is
 * inert on THIS book (all three master folios carry `⟨PREVIOUS⟩–⟨AUTO⟩`, so
 * the 29 dormant duplicates were caught either way), but an ordinary dormant
 * duplicate in the next edition is exactly a plain auto-folio on a disabled
 * layer.
 *
 * A BOUNDARY, NAMED OUT LOUD: `section-marker` and `text-variable` are NOT
 * included here. The former names a section, not a page; the latter is a
 * variable instance whose content the measurement doesn't reveal (in this
 * book that's `XREF_PAGE_NUMBER_TYPE` in the TABLE OF CONTENTS, not in the
 * folio). What each of them would print once the layer is enabled, nobody
 * measured, and inventing a verdict for an unmeasured state is forbidden.
 */
function hasPageNumberMarker(frame: ClaimFrame): boolean {
  return frame.paragraphs.some((p) =>
    p.markers.some(
      (m) => m === "auto-page-number" || m === "previous-page-number" || m === "next-page-number",
    ),
  );
}

/**
 * A page's name as a number, or null.
 *
 * Sections yield "iv", "A-1", "Дод-3" — all of these are legitimate page
 * names, and guessing a number out of them is not allowed. `null` leads into
 * `folio-unparsable`, not into a silent comparison against `NaN`, which
 * would be wrong always and silently.
 *
 * EXPORTED FOR THE ORACLE'S SAKE (`rewrite.ts`, §4.4 step 4), and as a
 * shared function rather than a copy: the audit and the plan must treat the
 * same names as numeric. Diverging, the two copies would produce a state
 * where the audit checks a page the plan declared non-numeric — a
 * discrepancy that's silent and visible only in its consequences.
 */
export function pageNumber(name: string): number | null {
  if (!/^\d+$/.test(name)) return null;
  return Number.parseInt(name, 10);
}

/**
 * THE THREE §4.9 DETECTORS — THE VISIBILITY A REPLACEMENT WOULD OTHERWISE TAKE AWAY.
 *
 * The entire folio rule lives inside `if (para.literals.length > 0)`, meaning
 * a frame WITHOUT literals never produces findings. After `pagination_audit`
 * successfully replaces a manual number with a marker, such a frame is blind
 * FOREVER — and the failure scenario is measured (Question 10): a broken
 * chain leaves no gap and gives no warning, it prints a plausible "121–121".
 * Without these checks the phase isn't neutral, it's harmful: it trades a
 * defect the audit CATCHES for a defect the audit CANNOT SEE.
 *
 * WHY THIS IS A SEPARATE FUNCTION, NOT A LOOP TAIL. It's called from TWO
 * places, and the second is a frame on a page with a NON-NUMERIC name. Until
 * now the `own === null` branch did a `continue` before this block, meaning a
 * roman-numeral preface or sectional numbering ("iv", "A-1", "Дод-3" —
 * legitimate names per the `PageRef.name` docstring) muted all three
 * detectors at once. They don't need a numeric name at all: they compare
 * `resolved` against `pg.name` and `pg.spreadSiblings` as STRINGS, and none
 * of the §4.9 triggers declares such a dependency.
 *
 * The check is counted PER FRAME, not per paragraph: such a frame has no
 * numeric paragraph-claim, so `paragraphIndex` is `null` here. The function
 * doesn't touch the counters (`checked`/`notCompared`) at all — they're
 * per-frame and were already counted by the caller.
 *
 * THE BRANCHES ARE MUTUALLY EXCLUSIVE, AND THAT'S A DECISION, NOT AN
 * ARTIFACT OF `else if`. A hidden frame that, once its layer is enabled,
 * would also be `unbound`, is reported only as `folio-dormant-duplicate`.
 * The basis: it doesn't print, so it isn't lying today — exactly what §4.9
 * says; and also reporting it as "the number is false RIGHT NOW" would be
 * saying something untrue about today's sheet.
 *
 * A BOUNDARY DELIBERATELY LEFT OPEN HERE (finding I4 of review `0abf0be`,
 * still alive and confirmed by execution in review `14c503b`).
 * `resolveMarkerPage` filters on `ThreadLink.fromMaster` — the origin of the
 * OVERLAPPED frame — and never looks at `ClaimFrame.fromMaster` (the origin
 * of the claim frame itself). Question 13 measured exactly the latter: a
 * marker in a NON-OVERRIDDEN master frame doesn't see the document chain
 * beneath it ("29–29" with an exact bounds match). So a master folio frame
 * that overlaps a document chain will get a page here — the opposite answer
 * from the measured one — and `folio-marker-unbound` will end up MISSED. On
 * this book the branch is inert (all 91 frames are document frames, master
 * folios have `overlaps: []`), but on an edition where the folio itself
 * sits on the master, this is an undetected defect. Fixing this in the
 * detector without asking whoever is leading the phase would silently
 * change the routing rule along with it.
 *
 * A SECOND BOUNDARY, NAMED AND LEFT OPEN: `ClaimFrame.layerPrintable` is
 * read by nothing here, so a frame on a `printable = false` layer lands in
 * `deviating` right alongside a printed one. It's measured (Question 8) that
 * `printable = false` behaves the OPPOSITE of `visible = false`: it does NOT
 * break marker resolution — which is exactly why the `_folio-helper` helper
 * layer is created as `printable = false, visible = true` (§4.8). So such a
 * frame yields the same number, but never lands on the sheet, and the
 * formula "the number is false RIGHT NOW" is too broad for it. Left open
 * deliberately: §4.9 talks ONLY about `visible`, and either possible outcome
 * changes the tool's public behavior — either one more defect in
 * `NON_DEVIATIONS`, or a silent demotion of existing ones. Neither was
 * required by measurement, and the choice belongs to whoever is leading the
 * phase.
 */
function detectMarkerDefects(pg: PageRef, frame: ClaimFrame, findings: PaginationFinding[]): void {
  const dirs = markerDirections(frame);

  if (!frame.layerVisible) {
    /*
     * `layer.visible` MEANS THE OPPOSITE IN TWO PLACES, and confusing them is
     * not allowed. The hidden layer of the frame ITSELF — it doesn't print, so
     * it isn't lying today; the hidden layer of the HELPER chain the frame
     * takes its number from (`ThreadLink.layerVisible`, checked inside
     * `resolveMarkerPage`) — the frame prints WITH a false number.
     *
     * The cost of confusing them is measured: in the book three master
     * folios sit on the `Нумерація` layer with `visible = false` and are live
     * on 29 pages. Without this branch the very first run would have produced
     * 29 FALSE-POSITIVE `folio-marker-unbound` findings — a mirror repeat of
     * Phase 6's failure, where the tool reported "all 91 folios clean".
     */
    if (!hasPageNumberMarker(frame)) return;
    findings.push({
      id: `folio:${frame.page}:${frame.id}:dormant`,
      family: "folio",
      defect: "folio-dormant-duplicate",
      page: frame.page,
      frameId: frame.id,
      paragraphIndex: null,
      claimed: null,
      actual: frame.layerName,
      detail:
        `The folio frame sits on a hidden layer "${frame.layerName}", meaning it's ` +
        "NOT printing TODAY — but the page-number marker inside it is live. As soon as the layer " +
        "is turned on, the frame will start printing a number nobody checked, and if the " +
        "page already has a visible folio, there will be two of them. Remove the frame or the layer if " +
        "they aren't needed; leave it deliberately if the layer is off on purpose.",
    });
    return;
  }

  if (dirs.length === 0) return;

  if (frame.overlaps === null) {
    /*
     * `null` MEANS "NOT MEASURED", AND IT MUST STAY AUDIBLE.
     *
     * `ClaimFrame.overlaps` has THREE states: a non-empty array, `[]`
     * ("checked among frames with known bounds — doesn't overlap," a FACT
     * about the layout), and `null` ("NOT CHECKED": the frame's own `bounds`
     * are unknown). The tempting fix `frame.overlaps ?? []` turns "not
     * measured" into "measured and empty" — and a frame nobody checked gets
     * `folio-marker-unbound`, i.e. lands in `deviating` as a PROVEN defect.
     * That's the same trade of visibility for silence that §3 stands against,
     * only in the other direction: not a missed defect, but an INVENTED one.
     *
     * But COMPLETE SILENCE here was a failure of the same kind, and
     * measurement showed it: review probe `14c503b` gave `checked = 1,
     * notCompared = 0, findings = 0` — a frame whose topology nobody measured
     * was, byte for byte, indistinguishable in the response from one checked
     * and clean. The channel that doesn't touch the counters already existed:
     * a finding in `NON_DEVIATIONS`, like `folio-unparsable`, which says
     * exactly the same thing — "not compared".
     *
     * Nothing here touches the counter, and the reason is arithmetic:
     * `checked` for this frame was already counted above, and `checked` and
     * `notCompared` in Phase 6 are mutually exclusive per frame (both
     * `notCompared += 1` branches sit BEFORE `checked += 1` and do a
     * `continue`). A third `notCompared` would count ONE frame twice — exactly
     * the defect fix round 2 removed for `folio-unparsable`.
     */
    findings.push({
      id: `folio:${frame.page}:${frame.id}:marker-unmeasured`,
      family: "folio",
      defect: "folio-marker-unmeasured",
      page: frame.page,
      frameId: frame.id,
      paragraphIndex: null,
      claimed: null,
      actual: null,
      detail:
        "The neighbor-page marker in this frame was NOT CHECKED: the measurement has no " +
        "bounds of its own for this frame (a master item for which no master page was found), so " +
        "no one counted overlaps for it. This isn't 'clean' — it's 'not compared': " +
        "the marker might resolve correctly, or it might not resolve at all, and " +
        "there's no way to tell which from this data. Check the frame by eye, or " +
        "move it onto a document page.",
    });
    return;
  }

  for (const dir of dirs) {
    const resolved = resolveMarkerPage(frame, dir);
    if (resolved === null) {
      findings.push({
        /* The direction in `id`: a frame with TWO markers produces two distinct
         * claims, and an identical `id` would make the finding's address
         * ambiguous. */
        id: `folio:${frame.page}:${frame.id}:marker-unbound:${dir}`,
        family: "folio",
        defect: "folio-marker-unbound",
        page: frame.page,
        frameId: frame.id,
        paragraphIndex: null,
        claimed: null,
        actual: null,
        detail:
          "The neighbor-page marker in the folio has nothing to resolve against: the frame doesn't " +
          "overlap any DOCUMENT frame of a text thread, or that " +
          "thread has no neighboring frame in the needed direction, or its layer is " +
          "hidden. In that case InDesign leaves no blank and gives no warning — " +
          "it prints the CURRENT page's number, so the folio looks like always " +
          "and shows the wrong number. Restore the frame's overlap with the helper " +
          "thread, or replace the marker with a number.",
      });
    } else if (!pg.spreadSiblings.includes(resolved)) {
      /*
       * THERE IS NO `resolved !== pg.name` CONDITION HERE, AND THAT'S THE
       * MAIN POINT OF THIS BRANCH.
       *
       * It used to stand here and excluded from the trigger the case "the
       * marker resolves to its OWN page" — i.e., the measured 2026-08-04
       * defect in its post-replacement form. Back then 52 folios printed
       * "96–96", and `folio-duplicates-auto` caught it — BY LITERAL; after
       * replacement there's no literal, so that detector is silent by
       * construction. Spec §4.9 defines the trigger as "the resulting PAIR OF
       * NUMBERS is not two pages of the same spread," and "97–97" is one page
       * twice, so the trigger holds. No separate name is introduced for this
       * symptom: two names for one symptom would confuse the operator.
       *
       * The state is reachable without anything exotic: it's enough for the
       * chain's previous frame to land on the same page — a duplicated page,
       * a second helper frame on the page, or route A (§4.2).
       */
      const ownPair = resolved === pg.name;
      const spread =
        pg.spreadSiblings.length > 0 ? pg.spreadSiblings.join(", ") : "just itself";
      findings.push({
        id: `folio:${frame.page}:${frame.id}:marker-cross-spread:${dir}`,
        family: "folio",
        defect: "folio-marker-cross-spread",
        page: frame.page,
        frameId: frame.id,
        paragraphIndex: null,
        claimed: resolved,
        actual: pg.spreadSiblings.length > 0 ? pg.spreadSiblings.join(", ") : null,
        detail: ownPair
          ? `The neighbor-page marker resolves to its OWN page ${resolved}: ` +
            "the chain's neighboring frame is on the same page as the folio. " +
            "No one names its spread neighbor here, and the numbers look " +
            "correct because they update themselves. Most likely the page was duplicated, or " +
            "the frame overlaps the wrong thread." +
            /* About the PRINTED pair — only when the frame actually has an
             * automarker: without it the frame prints a single number, and
             * "97–97" would be a claim about a state the detector never
             * checked. */
            (frame.paragraphs.some((p) => p.markers.includes("auto-page-number"))
              ? ` Together with the same frame's automarker it will print "${resolved}–${resolved}"` +
                " — exactly the form the book already had on 2026-08-04."
              : "")
          : `The marker resolves to page ${resolved}, and page ` +
            `${pg.name}'s spread consists of ${spread}. ` +
            "The printed pair is not two pages of one spread — most likely " +
            "the frame ended up on the wrong side after an odd change in page count, and " +
            "the marker now names a neighbor from a different spread. The number " +
            "updates itself, so it looks correct.",
      });
    }
  }
}

/**
 * The folio rule has TWO PARTS, and both are needed (spec §4.4).
 *
 * 1. every literal number must equal the number of its own page or of the
 *    neighboring page of the spread;
 * 2. a literal number must not equal the number the automarker in that same
 *    frame would produce — in a correct "neighbor–own" pair the numbers are
 *    always different.
 *
 * WHY EXACTLY TWO. Each part catches one of two MEASURED defects, and
 * neither catches both:
 *
 * - shift (2026-07-29, 76 pages, "94–97" on p. 97) — caught only by part 1:
 *   94 matches neither 97 nor 96;
 * - wrong side (2026-08-04, 52 folios, "96–96") — caught only by part 2:
 *   96 legitimately equals its own page, and part 1 lets it through.
 *
 * Part 2 is checked ONLY when an automarker is present: if all numbers are
 * typed by hand, there's nothing to duplicate — "6–7" on page 7 is correct.
 */
export function detectFolio(pages: PageRef[], frames: ClaimFrame[]): FamilyResult {
  const byName = new Map(pages.map((p) => [p.name, p]));
  /*
   * СКІЛЬКИ СТОРІНОК НЕСУТЬ ЦЮ НАЗВУ. Дві однойменні сторінки НЕРОЗРІЗНЮВАНІ,
   * але ВИЯВНІ, і ця різниця вирішальна: `Map` лишає ОСТАННЮ з них, тож рамка
   * судилася б проти чужого розвороту — а звідти беруться і `side`, і
   * `offset`, і `spreadSiblings`.
   *
   * `src/pagination/rewrite.ts` цей самий стан уже відмовляється судити
   * (`ambiguous-page-name`) і в коментарі прямо називає `detectFolio` як файл,
   * що «будує саме таку мапу». Будував — і судив: на книжці з додатком, який
   * починає нумерацію заново, правильна колонцифра «2–3» на ПЕРШІЙ сторінці 3
   * діставала сусідів другої й давала хибний folio-stale, а справді
   * протухлий літерал на ній же проходив мовчки.
   */
  const nameCount = new Map<string, number>();
  for (const p of pages) nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1);

  const findings: PaginationFinding[] = [];
  let checked = 0;
  let notCompared = 0;

  for (const frame of frames) {
    const pg = byName.get(frame.page);
    if (pg === undefined) {
      /* A frame on a page outside the measurement. "Not checked," not "clean". */
      notCompared += 1;
      continue;
    }

    if ((nameCount.get(frame.page) ?? 0) > 1) {
      /*
       * ВІДМОВЛЯЄМОСЬ СУДИТИ, А НЕ ВГАДУЄМО. Розрізнити їх не можна, але
       * відмовитися — можна, і відмова тут єдина безпечна сторона (§3):
       * і хибне спрацювання, і пропуск однаково ведуть читача не на ту
       * сторінку.
       */
      findings.push({
        id: `folio:${frame.page}:${frame.id}:ambiguous-page-name`,
        family: "folio",
        defect: "folio-ambiguous-page-name",
        page: frame.page,
        frameId: frame.id,
        paragraphIndex: null,
        claimed: null,
        actual: frame.page,
        detail:
          `The document has ${String(nameCount.get(frame.page))} pages named "${frame.page}" ` +
          "(a section that restarts its numbering). Which of them this frame sits on cannot be " +
          "told from the name, and every check here — own number, spread neighbour, side — " +
          "would be made against whichever page happened to be indexed last. The frame was " +
          "therefore NOT checked; renumber the sections or give them distinct prefixes.",
      });
      notCompared += 1;
      continue;
    }

    const own = pageNumber(pg.name);
    if (own === null) {
      findings.push({
        id: `folio:${frame.page}:${frame.id}:unparsable`,
        family: "folio",
        defect: "folio-unparsable",
        page: frame.page,
        frameId: frame.id,
        paragraphIndex: null,
        claimed: null,
        actual: pg.name,
        detail:
          `Page name "${pg.name}" is not a number — most likely a section with a different ` +
          "numbering style. Literal folio numbers can't be checked against it, " +
          "so the page wasn't checked.",
      });
      notCompared += 1;
      /*
       * THERE'S NOTHING TO CHECK LITERALS AGAINST, BUT THERE IS A MARKER,
       * and that's exactly why there's no `continue` here. The §4.9 detectors
       * compare STRINGS (`resolved` against `pg.name` and
       * `pg.spreadSiblings`), meaning they don't need a numeric name; until
       * now `continue` muted all three at once on such a page. The counter
       * stays the same: the frame goes into `notCompared`, because its
       * NUMBERS really aren't checked.
       */
      detectMarkerDefects(pg, frame, findings);
      continue;
    }

    checked += 1;

    const siblings: number[] = [];
    for (const name of pg.spreadSiblings) {
      const n = pageNumber(name);
      if (n !== null) siblings.push(n);
    }

    const hasAuto = frame.paragraphs.some((p) => p.markers.includes("auto-page-number"));

    for (const para of frame.paragraphs) {
      /*
       * "MANUAL NUMBER" IS A VALID FINDING ON ITS OWN, and that's exactly why
       * it's a separate defect, not a note: it will break on the next
       * recompose, even if it's correct RIGHT NOW.
       *
       * THE "AND NO AUTOMARKER" CONDITION WAS A BUG, found by a run on the
       * live book on 2026-08-07. There, all 91 folios look like
       * "6–<automarker>": the left number typed by hand, the right one
       * automatic. Under the old condition the tool was silent about all 91
       * — exactly the class that broke TWICE on this book (a −2 shift on 76
       * pages, and 52 frames on the wrong side).
       *
       * A mixed frame is even WORSE than a fully manual one: half the number
       * updates itself, half doesn't, so on recompose they'll drift apart,
       * while the folio will look the same as always.
       */
      if (para.literals.length > 0) {
        findings.push({
          id: `folio:${frame.page}:${frame.id}:${para.index}:manual`,
          family: "folio",
          defect: "folio-manual",
          page: frame.page,
          frameId: frame.id,
          paragraphIndex: para.index,
          claimed: para.literals.join("–"),
          actual: null,
          detail: hasAuto
            ? "Part of the folio is hand-typed, and part is an auto-numbering marker. " +
              "On recompose the automatic half will update and the hand-typed one won't, and they'll " +
              "drift apart — while the folio will look the same as always."
            : "The folio frame has no auto-numbering marker — every number is hand-typed. " +
              "Even if they're correct right now, the next recompose " +
              "will silently make them wrong.",
        });
      }

      for (const literal of para.literals) {
        /*
         * Part 2 goes FIRST and short-circuits this number's check: a
         * literal equal to its own page satisfies part 1 and, without this
         * branch, would pass as correct.
         */
        if (hasAuto && literal === own) {
          findings.push({
            id: `folio:${frame.page}:${frame.id}:${para.index}:dup:${literal}`,
            family: "folio",
            defect: "folio-duplicates-auto",
            page: frame.page,
            frameId: frame.id,
            paragraphIndex: para.index,
            claimed: String(literal),
            actual: siblings.length > 0 ? siblings.join(", ") : null,
            detail:
              `The hand-typed number ${literal} equals what the automarker will give (page ` +
              `${pg.name}), so the folio will print as "${literal}–${literal}". ` +
              "In a correct 'neighbor\u2013own' pair the numbers are always different — most likely " +
              "the frame ended up on the wrong side of the spread after an odd change " +
              "in page count.",
          });
          continue;
        }

        if (literal !== own && !siblings.includes(literal)) {
          findings.push({
            id: `folio:${frame.page}:${frame.id}:${para.index}:stale:${literal}`,
            family: "folio",
            defect: "folio-stale",
            page: frame.page,
            frameId: frame.id,
            paragraphIndex: para.index,
            claimed: String(literal),
            actual: siblings.length > 0 ? siblings.join(", ") : String(own),
            detail:
              `Number ${literal} doesn't match either its own page's number (${own}), or ` +
              "the number of the neighboring spread page " +
              `(${siblings.length > 0 ? siblings.join(", ") : "there are no numeric neighbors"}).`,
          });
        }
      }
    }

    /* The three §4.9 detectors run OUTSIDE the paragraph loop, and that's not
     * just style: the check is per-frame, and a frame without literals never
     * enters that loop at all. The second call is above, in the non-numeric
     * page-name branch. */
    detectMarkerDefects(pg, frame, findings);
  }

  return { checked, notCompared, findings };
}
