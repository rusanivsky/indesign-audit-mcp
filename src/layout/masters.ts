/**
 * The `masters` family: a page against its own master page. Pure TypeScript.
 *
 * THE DETECTOR DOESN'T KNOW WHICH MASTER PAGE IS CORRECT, AND SHOULDN'T
 * (spec §4.5).
 *
 * The original hypothesis was "a recto page gets a verso master page." It's
 * wrong: InDesign applies the master page as a SPREAD, and a page
 * automatically takes its own side — that state simply cannot occur.
 *
 * The real breakage mechanism is different. An odd page count shifts every
 * following page: a page that was verso becomes recto. The master page keeps
 * up with itself automatically. What does NOT keep up with itself is
 * whatever was DETACHED from the master: overridden items stay where they
 * were placed for the previous side, and deleted ones don't come back.
 *
 * That's why the detector reports the FACTS OF DETACHMENT, while the
 * distribution of master pages is handed off as a table. A rare master page
 * is not itself a finding: a chapter-opening page legitimately has a
 * different one. The main answer to this class of defect isn't the
 * detector — it's the map itself: a "page → side → master → folio" table
 * across 196 rows makes a shift visible to the eye in a second.
 *
 * THE MATCHING METHOD (measured by Task 2, the task report, the section
 * "What was measured about master items"; it DECISIVELY DISPROVES the
 * counting comparison from the original brief — `masterPageItems.length`
 * against `appliedMaster.pageItems.length` NEVER match by construction, even
 * on an undamaged page, probe from Task 1, Question 3). The method that works
 * is by IDENTITY, item by item of the master page (`.id`):
 *
 * 1. it's in `PageMeasure.masterItems` with the same `.id` → in place;
 * 2. it isn't there, but there's a record in `PageMeasure.pageItems` whose
 *    `overriddenMasterItemId` equals this `.id` → overridden
 *    (`overridden === true` on the item is a reliable positive indicator,
 *    confirmed on Task 2's fixture, though Task 1's probe never once saw
 *    this case on the real document);
 * 3. found in neither → deleted, and that's exactly why the detector stays
 *    silent (`continue`) for a page with no master page even BEFORE this
 *    step: "deleted" and "there's no master page at all" produce the same
 *    zero signature by the counters — the only thing that distinguishes them
 *    is `pg.master !== null`.
 *
 * FOLIO (Step 4). If the deleted master item carries an auto page-number
 * marker (`MasterItemRef.isFolio`, measured with a separate probe script:
 * `character.contents === SpecialCharacters.AUTO_PAGE_NUMBER` gives `true` —
 * a direct identity comparison WORKS here, unlike `appliedMaster`), the
 * detector emits a separate, more severe defect `folio-missing` instead of
 * the generic `master-item-missing`: otherwise a reader of the map wouldn't
 * see the difference between a missing decorative rule and a missing page
 * number.
 *
 * THE SECOND PATH TO A BROKEN FOLIO — implemented 2026-08-05. The item is
 * OVERRIDDEN, and the overridden content no longer has the auto-number (the
 * layout artist replaced it with manually typed text). This used to say
 * "deliberately not implemented: Task 2's fixture doesn't contain this state,
 * so this path can't be verified without a made-up test," and such an item
 * went through as a plain `master-item-overridden`. The fixture has been
 * extended (`_fixtures.jsx`, page 8: `override()` plus replacing the content
 * with fixed text), so the state now exists in the project and is verified
 * both by a unit test and by a live run.
 *
 * This case is WORSE than a deleted folio, and that's exactly why it gets the
 * same severe class: the page looks correct, the number is in place — until
 * recomposition shifts the page, and then the number goes wrong SILENTLY.
 * Telling it apart from a legitimate override (where only geometry was
 * moved) takes exactly one measurement — `PageOwnItem.hasAutoPageNumber`.
 *
 * THE MASTER PAGE'S COMPOSITION DEPENDS ON THE SIDE. The same master can have
 * different items on the left and right pages of a spread (folio on the left
 * and folio on the right have different `.id`s, measured on Task 2's
 * fixture). The `masterItems` map isn't required to distinguish sides by key
 * format (this file's unit tests deliberately do NOT distinguish sides — the
 * key there is always the "bare" master name), so the lookup tries the
 * QUALIFIED key `master#side` first and falls back to the "bare" name —
 * this way the real caller (a real call built from
 * `PageMeasure.expectedMasterItems`'s composition per side, `src/jsx/map.jsx`)
 * can pass a properly distinguished map, while simple tests can skip this
 * entirely.
 */

import type { LayoutFinding, MasterItemRef, PageMeasure } from "./types.js";

export interface MasterResult {
  findings: LayoutFinding[];
  /** Master page → pages, in order of appearance. A table, not a diagnosis. */
  distribution: { master: string | null; pages: string[] }[];
}

/**
 * The master page composition expected for this page: first try the key
 * qualified by side (`master#side`), and only if that doesn't exist —
 * the "bare" master page name.
 */
function lookupExpected(
  masterItems: Map<string, MasterItemRef[] | null>,
  master: string,
  side: string | null,
): MasterItemRef[] | null | undefined {
  if (side !== null && masterItems.has(`${master}#${side}`)) {
    /* `has`, не істинність значення: `null` тут — ЗМІСТОВНИЙ стан
     * («сторони не знайдено»), і провалитися з нього на «голе» ім'я майстра
     * означало б підмінити невідоме композицією іншої сторони. */
    return masterItems.get(`${master}#${side}`);
  }
  return masterItems.get(master);
}

export function detectMasters(
  pages: PageMeasure[],
  masterItems: Map<string, MasterItemRef[] | null>,
): MasterResult {
  const findings: LayoutFinding[] = [];
  const distribution: { master: string | null; pages: string[] }[] = [];

  for (const pg of pages) {
    let bucket = distribution.find((d) => d.master === pg.master);
    if (!bucket) {
      bucket = { master: pg.master, pages: [] };
      distribution.push(bucket);
    }
    bucket.pages.push(pg.name);

    if (pg.master === null) {
      findings.push({
        id: `page:${pg.name}:master-none`,
        family: "masters",
        defect: "master-none",
        group: null,
        page: pg.name,
        containerId: null,
        paragraphIndex: null,
        styleName: null,
        styleId: null,
        property: "appliedMaster",
        declared: null,
        actual: null,
        detail: `Page ${pg.name} has no applied master.`,
      });
      /* We deliberately stop here: a page with no master page hasn't "lost
       * items" — it has nothing to lose. Otherwise every such page would also
       * produce a finding for every item of someone else's master page. */
      continue;
    }

    const expected = lookupExpected(masterItems, pg.master, pg.side);

    if (expected === null) {
      /*
       * КОМПОЗИЦІЯ НЕВІДОМА — І ПРО ЦЕ ТРЕБА СКАЗАТИ, А НЕ ЗАМОВКНУТИ.
       *
       * `map.jsx` віддає `null`, коли жодна сторінка майстра не збіглася
       * стороною з документною. Доти на цьому місці стояв порожній масив, а
       * `[]` — істинне: перевірка нижче його пропускала, цикл по елементах
       * ішов нуль разів, і сторінка діставала нуль знахідок — байт у байт як
       * перевірена й чиста. Колонцифра, видалена зі сторінки 46, у такому
       * стані не давала нічого.
       */
      findings.push({
        id: `page:${pg.name}:master-composition-unknown`,
        family: "masters",
        defect: "master-composition-unknown",
        group: null,
        page: pg.name,
        containerId: null,
        paragraphIndex: null,
        styleName: null,
        styleId: null,
        property: "expectedMasterItems",
        declared: null,
        actual: null,
        detail:
          `No page of master "${pg.master}" matched this page's side (${pg.side ?? "unknown"}), ` +
          "so the expected composition is UNKNOWN and nothing on this page was compared " +
          "against it. This is “not compared”, not “nothing is missing”.",
      });
      continue;
    }

    /* `undefined` — про цей майстер вимір не сказав нічого; мовчимо, як і
     * раніше. Вигадувати композицію не можна. */
    if (expected === undefined) continue;

    const present = new Set(pg.masterItems.map((i) => i.id));
    /*
     * Not just a set of identifiers, but a map to the overridden item ITSELF:
     * for a folio you need to know not just "overridden" but also whether the
     * auto-number is still there. Same traversal, same cost.
     */
    const overriddenBy = new Map<string, (typeof pg.pageItems)[number]>();
    for (const own of pg.pageItems) {
      if (own.overriddenMasterItemId !== null) overriddenBy.set(own.overriddenMasterItemId, own);
    }
    const overriddenIds = new Set(overriddenBy.keys());

    for (const item of expected) {
      if (present.has(item.id)) continue; // in place

      if (overriddenIds.has(item.id)) {
        /*
         * A BROKEN FOLIO VIA OVERRIDE — Phase 4 debt, closed 2026-08-05. This
         * used to say "deliberately not implemented: the fixture doesn't
         * contain this state, so this path can't be verified without a
         * made-up test." The fixture has been extended
         * (`__fixture_make_layout`: the `mRightFolio` item is overridden and
         * its auto-number is replaced with manually typed text), so the state
         * now exists in the project, and the check is honest.
         *
         * The difference from `master-item-missing` and from a plain override
         * is significant: the item IS IN PLACE and looks like a folio, but
         * its number is no longer automatic. On any recomposition of the
         * book it will go wrong SILENTLY — worse than a missing number, which
         * is visible immediately.
         */
        const own = overriddenBy.get(item.id);
        if (item.isFolio && own !== undefined && !own.hasAutoPageNumber) {
          findings.push({
            id: `page:${pg.name}:folio-missing:${item.id}`,
            family: "masters",
            defect: "folio-missing",
            group: null,
            page: pg.name,
            containerId: null,
            paragraphIndex: null,
            styleName: null,
            styleId: null,
            property: item.id,
            declared: pg.master,
            actual: "overridden-without-auto-number",
            detail:
              `Master "${pg.master}" provides folio ${item.id}, and on page ${pg.name} ` +
              "it is overridden, but no longer carries the auto-numbering marker — the number " +
              "was manually killed. The page looks visually correct exactly until " +
              "recomposition shifts it.",
          });
          continue;
        }

        findings.push({
          id: `page:${pg.name}:overridden:${item.id}`,
          family: "masters",
          defect: "master-item-overridden",
          group: null,
          page: pg.name,
          containerId: null,
          paragraphIndex: null,
          styleName: null,
          styleId: null,
          property: item.id,
          declared: pg.master,
          actual: "overridden",
          detail:
            `Master "${pg.master}" provides element ${item.id} (${item.kind ?? "unknown type"}), ` +
            `but on page ${pg.name} it is overridden.`,
        });
        continue;
      }

      /* Not in place, not overridden — deleted. */
      if (item.isFolio) {
        findings.push({
          id: `page:${pg.name}:folio-missing:${item.id}`,
          family: "masters",
          defect: "folio-missing",
          group: null,
          page: pg.name,
          containerId: null,
          paragraphIndex: null,
          styleName: null,
          styleId: null,
          property: item.id,
          declared: pg.master,
          actual: null,
          detail:
            `Master "${pg.master}" provides the page auto-numbering marker (${item.id}), ` +
            `but on page ${pg.name} it is missing — the page number will not print.`,
        });
        continue;
      }

      findings.push({
        id: `page:${pg.name}:missing:${item.id}`,
        family: "masters",
        defect: "master-item-missing",
        group: null,
        page: pg.name,
        containerId: null,
        paragraphIndex: null,
        styleName: null,
        styleId: null,
        property: item.id,
        declared: pg.master,
        actual: null,
        detail:
          `Master "${pg.master}" provides element ${item.id} (${item.kind ?? "unknown type"}), ` +
          `but on page ${pg.name} it is missing.`,
      });
    }
  }

  return { findings, distribution };
}
