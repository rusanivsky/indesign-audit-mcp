/**
 * The `usage` family, second half: whether an unused style can be DELETED.
 *
 * WHY THIS IS A SEPARATE DETECTOR, NOT A FIELD IN `inventory.ts`. "0 paragraphs" and
 * "excess" are different claims, and it is exactly identifying them that breaks a layout.
 * Measured on the live book on 2026-08-16: `style-unused` named 14 styles, of
 * which 9 turned out to be ABSTRACT BASES — no paragraph rests on them, but
 * other styles do. Deleting `Чеклист 2` (0 paragraphs, 6 descendants with
 * 415 paragraphs) bumped `Пункт чеклисту` and `Підпункт чеклисту` onto the GRANDPARENT,
 * and 387 checklist paragraphs fell into the exception; deleting `Стиль абзацу 1`
 * stripped `Заголовок 2 до інтерв'ю` of its centering.
 *
 * THE MECHANISM THAT CAUSES THIS (measured, not assumed): `style.remove()`
 * re-hooks the children onto the GRANDPARENT, and the deleted style's own
 * overrides disappear. That is, a child that did not declare a property, after the
 * parent is deleted, inherits a DIFFERENT value. So "the style is applied to nothing"
 * is not and cannot be permission to delete it.
 *
 * Pure TypeScript — does not talk to InDesign. The input is the same
 * `basedOnId` that `hierarchy.ts` uses to resolve chains: by `id`, NOT by
 * name (in the book two different styles are called "Основний текст L", and
 * counting by name would hide the dead one behind the live one).
 */

import type { DeclaredStyle } from "./types.js";

/**
 * What an abstract base carries on itself. Both numbers are TRANSITIVE and count
 * only the descendants that WILL SURVIVE cleanup, i.e. are not themselves leaves.
 *
 * Why not all descendants in a row: the number must answer the operator's question
 * "what falls if I delete this style AFTER removing what's safe."
 * A dead branch that will be removed anyway does not belong in this answer —
 * otherwise the base would look more heavily loaded than it is.
 */
export interface BaseLoad {
  /** How many styles fall, counting grandchildren, not just direct children. */
  dependantStyles: number;
  /** How many paragraphs stand on those styles combined. */
  dependantParagraphs: number;
}

export interface UnusedClassification {
  /**
   * `id`s of styles SAFE to delete: no paragraph is on them and no
   * live descendant will remain. A set "cleaned iteratively" — see below.
   */
  leaves: Set<string>;
  /** `id` → load. Unused, but STRUCTURAL: cannot be deleted. */
  bases: Map<string, BaseLoad>;
}

/**
 * Splits unused styles into leaves and bases.
 *
 * ITERATIVE CLEANUP, NOT A SINGLE PASS. A style whose children are themselves unused
 * leaves becomes a leaf AFTER they are deleted — exactly the Word legacy in the book:
 * `heading 3` and `heading 4` are dead and stand on the dead `Normal`, so
 * all three come off, but in one pass `Normal` would have looked like a base.
 * Hence — a fixed point: keep adding to the leaves while it keeps growing.
 *
 * `basedOn` CYCLES ARE DELIBERATELY NOT UNROLLED. A style pointing to itself or a pair
 * X↔Y never enters the leaves (each holds up the other), and this is conservatively
 * correct: better to not call safe something we have not proven, than to
 * invite the operator to delete a style in a cycle. `hierarchy.ts` already
 * reports such chains separately — no need to duplicate the verdict here.
 *
 * @param paragraphsByStyleId how many paragraphs apply each style; a style
 *   absent from the map is considered unused (zero), not skipped:
 *   "no row" must read as 0, otherwise an unused style silently disappears.
 */
export function classifyUnusedStyles(
  styles: DeclaredStyle[],
  paragraphsByStyleId: Map<string, number>,
): UnusedClassification {
  const byId = new Map<string, DeclaredStyle>();
  for (const s of styles) byId.set(s.id, s);

  /* Children by the parent's `id`. Only store `basedOnId`s that resolve to
   * an existing style: a reference to nowhere makes nobody a base (it has its
   * own `based-on-missing` finding in `hierarchy.ts`). */
  const children = new Map<string, string[]>();
  for (const s of styles) {
    if (s.basedOnId === null) continue;
    if (!byId.has(s.basedOnId)) continue;
    const list = children.get(s.basedOnId);
    if (list) list.push(s.id);
    else children.set(s.basedOnId, [s.id]);
  }

  const paragraphsOf = (id: string): number => paragraphsByStyleId.get(id) ?? 0;
  const unused = styles.filter((s) => paragraphsOf(s.id) === 0).map((s) => s.id);
  const unusedSet = new Set(unused);

  const leaves = new Set<string>();
  for (;;) {
    let grew = false;
    for (const id of unused) {
      if (leaves.has(id)) continue;
      const kids = children.get(id) ?? [];
      /* A child lets the parent off the hook only if it is itself already recognized as a leaf.
       * A live child or a child-base block forever — they remain in the
       * document, so the parent remains their parent. */
      if (kids.every((kid) => leaves.has(kid))) {
        leaves.add(id);
        grew = true;
      }
    }
    if (!grew) break;
  }

  const bases = new Map<string, BaseLoad>();
  for (const id of unused) {
    if (leaves.has(id)) continue;
    bases.set(id, load(id, children, paragraphsOf, leaves));
  }
  /* `unusedSet` exists only as a reader's invariant: every unused style
   * ended up in exactly one of the two sets, there is no third state. */
  if (leaves.size + bases.size !== unusedSet.size) {
    throw new Error(
      `classifyUnusedStyles: ${String(leaves.size)} + ${String(bases.size)} !== ${String(unusedSet.size)}`,
    );
  }
  return { leaves, bases };
}

/**
 * The base's transitive load: descendants that survive cleanup, and the sum of
 * their paragraphs.
 *
 * `visited` is seeded with the ROOT ITSELF — otherwise a cycle X→Y→X would count the root
 * as its own descendant and spin forever.
 *
 * A leaf descendant IS TRAVERSED but not counted: the traversal through it is left
 * deliberately, so the number does not depend on whether a leaf can have its own
 * non-leaf children. By construction of the fixed point it cannot (a parent becomes
 * a leaf only once ALL its children are already leaves), so the traversal here is
 * insurance against a future rule change, not a live branch.
 */
function load(
  rootId: string,
  children: Map<string, string[]>,
  paragraphsOf: (id: string) => number,
  leaves: ReadonlySet<string>,
): BaseLoad {
  const visited = new Set<string>([rootId]);
  const queue = [...(children.get(rootId) ?? [])];
  let dependantStyles = 0;
  let dependantParagraphs = 0;
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) break;
    if (visited.has(id)) continue;
    visited.add(id);
    if (!leaves.has(id)) {
      dependantStyles += 1;
      dependantParagraphs += paragraphsOf(id);
    }
    for (const kid of children.get(id) ?? []) queue.push(kid);
  }
  return { dependantStyles, dependantParagraphs };
}
