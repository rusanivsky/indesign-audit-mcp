import { homedir } from "node:os";
import { basename } from "node:path";
import { callTool, type ToolBox } from "../collect.js";

export class SessionError extends Error {
  constructor(message: string, readonly hint: string) {
    super(`${message}\n\nWhat to do: ${hint}`);
    this.name = "SessionError";
  }
}

export interface OpenDoc {
  name: string;
  /** `null` — the document has never been saved to disk (no path). */
  fullName: string | null;
  modified: boolean;
}

export interface StatusShape {
  version?: string;
  locale?: string;
  documents: OpenDoc[];
  /**
   * The name of the document that's IN FRONT (`app.activeDocument.name`,
   * `src/jsx/inspect.jsx:21`); `null`/missing — no document is open. The
   * run must return this very document to the front when it finishes
   * (task G, R41 step 4): this is the user's environment, not ours.
   */
  activeDocument?: string | null;
}

export interface EnvironmentStamp {
  indesignVersion: string;
  docName: string;
  docPath: string;
  modified: boolean;
  wasAlreadyOpen: boolean;
  openDocumentCount: number;
  dictionaryPath: string | null;
  locale: string;
  sessionUptimeMs: number | null;
  /**
   * Not `null` when `release()` deliberately did NOT close the document
   * because it couldn't unambiguously identify which of the open ones is
   * ours (task 4 review, finding #2). The run must honestly say it didn't
   * clean up after itself, rather than guess and risk closing someone
   * else's document.
   */
  releaseSkippedReason: string | null;
}

export interface SessionHandle {
  stamp: EnvironmentStamp;
  /** Closes the document WITHOUT saving — and only the one we opened. */
  release(): Promise<void>;
  /**
   * Brings back to front the document that was active BEFORE the run (R41,
   * step 4). `null` — restored, or there was nothing to restore (the target
   * was already in front, or there were no documents at all); a string is
   * the reason it failed.
   *
   * Throws NO error at all: it's called in `finally`, where a thrown error
   * would clobber both the exit code and the reason for the real failure.
   */
  restoreActiveDocument(): Promise<string | null>;
}

/**
 * Normalizes a path for comparing document identity (review, round 3, R23
 * — proven by a LIVE run, not a hypothesis). `indesign_status` returns
 * `fullName` in InDesign's OWN encoding, not the POSIX form from the
 * config:
 *   1. a leading tilde instead of the home directory (`~/Library/…`, not
 *      `/Users/name/…`);
 *   2. percent-encoding (`%20` instead of a space, and every UTF-8 byte of
 *      a Cyrillic character as its own `%XX`);
 *   3. Unicode NFD — macOS stores «й» as «и» plus a separate combining
 *      breve (U+0306), not as the single codepoint U+0439.
 * None of these three forms EQUALS the POSIX path, even for the same file.
 * They can only be compared AFTER bringing both sides to the same form —
 * and specifically the full path, not a tail or a basename: otherwise two
 * different files with the same name would collide again (exactly what
 * R10 guards against).
 */
export function normalizePathForComparison(path: string): string {
  let result = path;

  // 1. percent-decode. An incorrect sequence (e.g. a lone "%",
  // not part of an escape) must NOT crash the audit — we leave the string as
  // it is and move on to steps 2–3 over what we have.
  try {
    result = decodeURIComponent(result);
  } catch {
    /* leave the result as it was before the decode attempt */
  }

  // 2. Expand a LEADING tilde into the home directory (only as the first
  // character of the path — a tilde elsewhere in the file name stays a tilde).
  if (result === "~" || result.startsWith("~/")) {
    result = homedir() + result.slice(1);
  }

  // 3. Unicode normalization to NFC: without it «й» in decomposed form
  // (macOS/Google Drive) doesn't equal «й» in the regular form (how a
  // POSIX path is normally typed), even after decoding.
  return result.normalize("NFC");
}

/**
 * Document policy (spec §6.1).
 *
 * The key part here is the "already open" branch: closing such a document
 * would mean closing the user's LIVE layout along with unsaved edits. This
 * exact state is what the spec describes as «66 проти 0».
 *
 * Task 4 review, finding #1: a match on `basename` alone ("the same file"
 * by name) does NOT mean the same document — InDesign can have a
 * same-named file open from a COMPLETELY different folder. Attaching to it
 * would be measuring the wrong document, just not in the form the spec
 * worries about (here the document is NOT closed, but the WRONG file gets
 * AUDITED). So only a document whose `fullName` — AFTER normalization
 * (`normalizePathForComparison`, R23) — matches the normalized
 * `wantedPath` counts as the target. The comparison is still by the FULL
 * path, not the basename: otherwise R10 would break again on two
 * different files with the same name.
 *
 * The exception is a document that has NEVER been saved to disk
 * (`fullName === null`): for it, no path exists at all, so a name match is
 * the only signal available. Such a match is accepted only when there is
 * EXACTLY one candidate; two or more is ambiguity, and it must be refused
 * explicitly, not resolved by guessing the first one.
 */
export function chooseDocument(
  status: StatusShape,
  wantedPath: string,
): { action: "attach" | "open"; docName: string | null } {
  const wantedName = basename(wantedPath);
  const normalizedWantedPath = normalizePathForComparison(wantedPath);

  const exactMatch = status.documents.find(
    (d) => d.fullName !== null && normalizePathForComparison(d.fullName) === normalizedWantedPath,
  );
  if (exactMatch !== undefined) return { action: "attach", docName: exactMatch.name };

  /*
   * NAMES ARE ALSO NORMALIZED, AND THIS ISN'T SYMMETRY FOR SYMMETRY'S SAKE.
   *
   * The saved-document branch runs through `normalizePathForComparison`,
   * while this one used to compare names RAW — and broke on every
   * Ukrainian name created on macOS. Measured 2026-08-17 on «Book B 2022 Print
   * 3 copy.indd»: in the name InDesign returned, «ї»
   * is DECOMPOSED (U+0456 + U+0308, codes 1110 and 776), while the rest of
   * the letters aren't. A «ї» typed on the keyboard is U+0457. The strings
   * look identical, `===` returns false, and the CLI refused with "none of
   * them is the target," printing that very same name in the list of open
   * documents two lines above.
   *
   * In other words, without this normalization, attaching to an UNSAVED
   * document doesn't work for a Ukrainian name at all — and an unsaved
   * document is exactly the case where there's no path yet and the only
   * way to address it is by name.
   */
  const wantedNameNormalized = wantedName.normalize("NFC");
  const unsaved = status.documents.filter(
    (d) => d.fullName === null && d.name.normalize("NFC") === wantedNameNormalized,
  );
  if (unsaved.length === 1) {
    // Length was just checked — index 0 exists.
    return { action: "attach", docName: unsaved[0]!.name };
  }
  if (unsaved.length > 1) {
    throw new SessionError(
      `There are ${unsaved.length} unsaved document(s) with the name "${wantedName}" — ` +
        "impossible to tell which one is the target.",
      "Save the target document to disk (then it will get a path and " +
        "the ambiguity will disappear), or close the extra unsaved documents with " +
        "the same name.",
    );
  }

  /*
   * Task G: this used to state the rationale "app.activeDocument = doc
   * silently doesn't work" (spec §6.1). A probe on InDesign 21.5.1.73
   * measured the opposite — the assignment took effect and read back —
   * so that evidence is no longer cited: a document that's ALREADY OPEN
   * is now brought to the front by the run itself and verified by
   * measurement (R41, below in `openSession`).
   *
   * The refusal itself stays, and not out of inertia: this is a different
   * case — the target document is NOT among the open ones at all, i.e.
   * this is about whether to OPEN a new document on top of others. That's
   * §6.1 policy, and R41 didn't revisit it; changing it is a separate
   * decision with its own rationale, not a side effect of the switch
   * turning out to work.
   */
  if (status.documents.length > 0) {
    const openList = status.documents.map((d) => `"${d.name}"`).join(", ");
    throw new SessionError(
      `InDesign has ${openList}, and the target "${wantedName}" isn't among them.`,
      "Close the extra documents, or point --doc at the FULL path of the one that's already " +
        "open (document identity is the path, not the name: R10/R23). " +
        "Measuring the wrong document is worse than not measuring at all.",
    );
  }

  return { action: "open", docName: null };
}

/**
 * Builds the ES3 body for `indesign_run_jsx`. The handler
 * (`src/jsx/run.jsx`) expects a `script` parameter, not `code`, and reads
 * the result FROM THE VARIABLE `__result` (`eval(body)` is called for its
 * side effect, and the value of `eval` itself is discarded) — not from the
 * last expression. This file used to send `{ code: "...; \"ok\"" }`, which
 * on a real run silently became a no-op script (`params.script ===
 * undefined` → `eval(undefined)` → `__result` stays `null`): `app.open()`
 * would NEVER actually get called. Found during round 2 of review, fixed
 * in both places this file calls `indesign_run_jsx`.
 */
function toRunScript(body: string): { script: string } {
  return { script: body };
}

/** What InDesign reported about the "in front" state, before and after the switch attempt. */
interface ActiveProbe {
  /** Whether a document with that name was found at all. */
  found: boolean;
  /**
   * How many OPEN documents have this name. Almost always 1, but this
   * very field is what tells "someone else's document is in front" apart
   * from "a same-named twin from a different folder is in front" — and
   * those are different failures with different advice.
   */
  sameNameCount: number;
  /** Who was in front BEFORE the assignment; `null` — no document was open. */
  beforeName: string | null;
  /** Whether we assigned at all: `false` — the wanted document was already in front. */
  switched: boolean;
  /** The name of the document in front AFTER the attempt; `null` — none open. */
  active: string | null;
  /** The raw `fullName` of the same document; `null` — it was never saved. */
  activeFullName: string | null;
}

/**
 * Brings the document to the front and IMMEDIATELY reads back who's
 * actually in front (task G, ruling R41, steps 1–2).
 *
 * Reading it back isn't extra caution, it's the whole point: spec §6.1
 * claimed that `app.activeDocument = doc` silently doesn't work, a probe
 * on InDesign 21.5.1.73 measured the opposite
 * (`{"took":true,"afterSet":"…"}`), and that's exactly why NEITHER version
 * can be trusted — a modal dialog or some other app state can change the
 * outcome on any given machine. The assignment and the read happen in ONE
 * call: two separate calls would leave a window between them for
 * something else to end up in front.
 *
 * `activeFullName` is taken there too, in InDesign's RAW form — so it can
 * be checked against the same raw `fullName` captured during
 * `openSession` (R23: ExtendScript 4.5.6 has no
 * `String.prototype.normalize`, so on the JSX side the comparison stays
 * raw-against-raw).
 *
 * **State is read BEFORE the assignment, and the assignment happens only
 * when needed** (round 1 review). An unconditional assignment used to
 * ruin an already-correct state just to complain about it afterward: when
 * two same-named documents are open, `itemByName` returns whichever one it
 * finds first, so the run would bring a WRONG twin to the front even when
 * the right file was already in front. Now we first read who's in front,
 * check it against the same rule (path, or name if there's no path), and
 * only touch `app.activeDocument` if it isn't the right one. Atomicity
 * isn't compromised: the read, the decision, and the assignment all
 * happen in ONE script.
 *
 * `sameNameCount` is counted in the same place: it tells "someone else's
 * document is in front" apart from "a same-named twin is in front," and
 * those call for different advice to the operator.
 *
 * This doesn't change the document itself: being active is app state, not
 * layout content; switching windows doesn't cause `modified`.
 */
async function bringToFront(
  box: ToolBox,
  name: string,
  expectedRawFullName: string | null,
): Promise<ActiveProbe> {
  const raw = await callTool<Partial<ActiveProbe>>(
    box,
    "indesign_run_jsx",
    toRunScript(
      `var __name = ${JSON.stringify(name)};` +
        `var __want = ${JSON.stringify(expectedRawFullName)};` +
        `var __n = 0;` +
        `for (var __i = 0; __i < app.documents.length; __i++) { if (app.documents[__i].name === __name) __n = __n + 1; }` +
        `var __c = (app.documents.length > 0 ? app.activeDocument : null);` +
        `var __cn = (__c === null ? null : __c.name);` +
        `var __cf = ((__c !== null && __c.saved) ? String(__c.fullName) : null);` +
        `var __d = app.documents.itemByName(__name);` +
        `var __sw = false;` +
        `if (__d.isValid) {` +
        `  var __ok = (__cn === __name && (__want === null || __cf === __want));` +
        `  if (!__ok) { app.activeDocument = __d; __sw = true; }` +
        `}` +
        `var __a = (app.documents.length > 0 ? app.activeDocument : null);` +
        `__result = {found:__d.isValid, sameNameCount:__n, beforeName:__cn, switched:__sw,` +
        ` active:(__a === null ? null : __a.name),` +
        ` activeFullName:((__a !== null && __a.saved) ? String(__a.fullName) : null)};`,
    ),
  );

  /* A missing field isn't the same as `null`, but for deciding "did it take
   * or not" it's equally NOT confirmation. We fold it to `null` here so the
   * failure doesn't show the operator "in front is „undefined“" instead of
   * human words. */
  return {
    found: raw.found === true,
    sameNameCount: raw.sameNameCount ?? 0,
    beforeName: raw.beforeName ?? null,
    switched: raw.switched === true,
    active: raw.active ?? null,
    activeFullName: raw.activeFullName ?? null,
  };
}

/**
 * Takes a snapshot of the environment. Without it, a run on a different
 * machine is silently a different measurement: a localized InDesign build
 * silently returns zeros at the language gate
 * (`src/spelling/dictpath.ts:41` matches ENGLISH language names).
 *
 * Task 4 review, finding #2: when we open the document ourselves, the name
 * for the later `release()` is NOT guessed (it used to be
 * `basename(docPath)` as a guess, if a repeated `indesign_status` found no
 * match). Instead we take the set difference between the names "before
 * opening" and "after opening" — the document that APPEARED is exactly
 * ours. This is a measurement that's resilient to the fact that `fullName`
 * after opening doesn't always come back byte-identical to `docPath`
 * (Unicode normalization, symbolic links). If not exactly one new document
 * appeared (0 or 2+), identification is impossible, and `release()`
 * deliberately closes NOTHING, with the reason recorded in
 * `stamp.releaseSkippedReason`.
 */
export async function openSession(
  box: ToolBox,
  docPath: string,
): Promise<SessionHandle> {
  const before = await callTool<StatusShape>(box, "indesign_status", {});
  const decision = chooseDocument(before, docPath);

  let after = before;
  let nameToClose: string | null = null;
  let releaseSkippedReason: string | null = null;

  if (decision.action === "open") {
    const namesBefore = new Set(before.documents.map((d) => d.name));
    await callTool(
      box,
      "indesign_run_jsx",
      toRunScript(`app.open(File(${JSON.stringify(docPath)})); __result = "ok";`),
    );
    after = await callTool<StatusShape>(box, "indesign_status", {});
    const newDocs = after.documents.filter((d) => !namesBefore.has(d.name));

    if (newDocs.length === 1) {
      // Length was just checked — index 0 exists.
      nameToClose = newDocs[0]!.name;
    } else if (newDocs.length === 0) {
      releaseSkippedReason =
        "After app.open() no new name " +
        "appeared in the list of open documents — it's unclear which document to close, " +
        "so the document is left open.";
    } else {
      releaseSkippedReason =
        `After app.open() ${newDocs.length} new document(s) appeared — ` +
        "it's unclear which one we just opened, so none was closed.";
    }
  }

  // Discriminated on `рішення.action`: when it's "attach", `docName` is always
  // non-empty (chooseDocument guarantees this) — the non-null assertion reflects
  // exactly that guarantee, not an assumption.
  const targetName =
    decision.action === "attach" ? decision.docName! : (nameToClose ?? basename(docPath));
  const normalizedTargetPath = normalizePathForComparison(docPath);
  /*
   * Task G: two searches in a row, NOT one `find` with `||` inside.
   * The difference isn't cosmetic — it was found by the test "same-named
   * document from a different folder." `find` returns the FIRST element
   * that satisfies the predicate, so with `||` the array order mattered
   * more than the strength of the signal: a same-named foreign file
   * listed earlier would win over an exact path match. And `док?.fullName`
   * is exactly the reference value that both the switch (below) and the
   * close (`release()`) check against, so a bug here silently disarmed
   * both checks. PATH first (the only real identity, R10/R23), and only
   * when there's no path to match — the name.
   */
  const doc =
    after.documents.find(
      (d) => d.fullName !== null && normalizePathForComparison(d.fullName) === normalizedTargetPath,
    ) ?? after.documents.find((d) => d.name === targetName);

  /*
   * R23: for the check in `release()`, we do NOT pass in `docPath` (POSIX,
   * as the caller gave it) — ExtendScript ES3 has no
   * `String.prototype.normalize`, and hand-rolling percent-decode +
   * Unicode NFC inside JSX would mean re-implementing macOS-specific
   * encoding logic with no way to verify it against the live engine.
   * Instead we remember the RAW `fullName` that InDesign itself just
   * returned for this document (`док?.fullName`), and check it against
   * what InDesign returns AGAIN when closing — both sides in the SAME
   * InDesign encoding, so they can be compared byte-for-byte with no
   * normalization inside ExtendScript at all. If `fullName` is `null` for
   * an unsaved document, `release()` cannot confirm the path and
   * deliberately won't close it (safe default).
   */
  const expectedRawFullName: string | null = doc?.fullName ?? null;

  /* ------------------------------------------------------------------
   * Task G, ruling R41: attaching to a document is not yet measuring it.
   *
   * The session layer picks the document by the NORMALIZED PATH from the
   * config, while the measurement layer (`IDMCP.activeDoc()`,
   * `src/jsx/_core.jsx:102`) reads `app.activeDocument`. As long as only
   * ONE document is open, the two agree — which is why neither the 2390
   * tests nor the first live run saw the bug. On the second live run,
   * 2026-08-16, two documents were open: the cover was in front (1 page,
   * 2 paragraph styles), the target was the book (196 pages, 56 styles).
   * The session named the book correctly, and stage 2 queried the cover
   * and refused on a style that DOES exist in the book (99 paragraphs).
   * What saved the case: if the style names had matched, the CLI would
   * have measured the cover and signed the report with the book's name.
   *
   * Hence: bring the target to the front, VERIFY IT BY MEASUREMENT, and
   * refuse if it didn't take (exit code 3, spec §6.4). Never measure while
   * someone else's document is in front.
   * ------------------------------------------------------------------ */
  const previousActive: string | null = before.activeDocument ?? null;

  const active = await bringToFront(box, targetName, expectedRawFullName);

  /*
   * R41, step 4: the user's environment must be left as it was. Called
   * both on the success path (from `audit.ts`, in `finally`) and right
   * here before refusing — a run that crashed in the middle and left
   * someone else's document in front is the same discourtesy, just
   * quieter.
   *
   * Identity here is by NAME, not by `fullName`, and that's deliberately
   * not the same as in `release()`: that one CLOSES the document, so an
   * identity mistake costs lost edits, while here the worst outcome is a
   * same-named document from a different folder ending up in front. The
   * content never changes either way.
   *
   * The early exit asks the PROBE, not the name (round 1 fix). It used to
   * be `попереднійАктивний === цільоваНазва` — and in a state with two
   * same-named documents that gave a false "nothing to restore": the
   * names match, even though a DIFFERENT file — the one we ourselves
   * brought forward — ended up in front. Now the condition is direct: if
   * we switched nothing (`switched === false`) and the same document was
   * in front as before the run, there's truly nothing to restore.
   */
  async function restorePreviousActive(): Promise<string | null> {
    if (previousActive === null) return null; // nothing was in front
    if (!active.switched && active.beforeName === previousActive) return null;

    try {
      const back = await callTool<{ restored: boolean; active: string | null }>(
        box,
        "indesign_run_jsx",
        toRunScript(
          `var __p = app.documents.itemByName(${JSON.stringify(previousActive)});` +
            `if (__p.isValid) { app.activeDocument = __p; }` +
            `__result = {restored:__p.isValid, active:(app.documents.length > 0 ? app.activeDocument.name : null)};`,
        ),
      );
      if (back.restored && back.active === previousActive) return null;
      const nowActive = back.active === null ? "none" : `«${back.active}»`;
      return (
        `failed to bring document "${previousActive}", ` +
        `which was active before the run (${back.restored ? "the switch didn't take" : "that document isn't open anymore"}; ` +
        `in front is ${nowActive}).`
      );
    } catch (e) {
      return (
        `failed to bring document "${previousActive}", ` +
        `which was active before the run (${e instanceof Error ? e.message : String(e)}).`
      );
    }
  }

  /* Checked against the STRONGEST signal available: if InDesign gave a path
   * for this document — compare paths (raw-against-raw, R23); if the
   * document was never saved, no path exists and the name is what's left. */
  const tookEffect =
    active.found &&
    active.active === targetName &&
    (expectedRawFullName === null || active.activeFullName === expectedRawFullName);

  if (!tookEffect) {
    const restoreFailure = await restorePreviousActive();
    const tail = restoreFailure === null ? "" : ` Also, ${restoreFailure}`;

    /*
     * TWO DIFFERENT FAILURES, because the causes and the actions differ
     * (round 1 review).
     *
     * When the name in front MATCHES the target but the path doesn't, this
     * is a same-named twin from a different folder: `app.documents.itemByName`
     * only knows the name, and a name isn't identity (R10). The shared
     * message here used to name the document in front as itself
     * ("…document «X» — in front is «X»") and advised "click its window
     * and run again" — advice that CANNOT work: the next run would call
     * `itemByName(назва)` again and get the exact same twin again. A
     * failure that recommends a futile action is the same class as R27 and
     * G2 in this same task.
     */
    const twin =
      active.found &&
      active.active === targetName &&
      expectedRawFullName !== null &&
      active.activeFullName !== expectedRawFullName;

    if (twin) {
      const frontPath =
        active.activeFullName === null
          ? "a document that was never saved to disk"
          : active.activeFullName;
      throw new SessionError(
        `The document in front has the same name "${targetName}", but from a different path. ` +
          `Needed: "${expectedRawFullName}", and in front is "${frontPath}". ` +
          `Documents open with this name "${targetName}": ${active.sameNameCount}.` +
          tail,
        `Close the extra document named "${targetName}" — the one that's NOT at the path ` +
          `"${expectedRawFullName}". Simply clicking the right window and repeating ` +
          "the run isn't enough: InDesign looks up the document by name " +
          "(app.documents.itemByName), and a name isn't identity — the same wrong " +
          "file will end up in front again.",
      );
    }

    const front = active.active === null ? "no document" : `"${active.active}"`;
    throw new SessionError(
      `Failed to bring the target document "${targetName}" to the front — in front is ${front}.` +
        (active.found ? "" : " There's no document with that name in InDesign anymore.") +
        tail,
      "Make the target document active in InDesign (click its window) and " +
        "run again. There will be no measurement while a different document is in front: " +
        "every pass and stage 2 read app.activeDocument, so it would measure " +
        "the wrong document, and the report would be signed with its name.",
    );
  }

  const stamp: EnvironmentStamp = {
    indesignVersion: after.version ?? "?",
    docName: doc?.name ?? targetName,
    docPath,
    modified: doc?.modified ?? false,
    wasAlreadyOpen: decision.action === "attach",
    openDocumentCount: after.documents.length,
    dictionaryPath: null,
    locale: after.locale ?? "?",
    sessionUptimeMs: null,
    releaseSkippedReason,
  };

  /*
   * I8: `release()` is now called both on the success path (so
   * `releaseSkippedReason` makes it into `measurements.json` in time) and
   * in `finally` (so a document we opened gets closed even on an
   * environment-failure path). So it has to be TRULY IDEMPOTENT, not just
   * "does nothing when the document was already open": a second call
   * without this guard would hit InDesign again, find no just-closed
   * document, and overwrite `releaseSkippedReason` with "a document with
   * that name is no longer open" — a reason that never existed. In other
   * words, the report about our own cleanup would become false exactly
   * because the cleanup SUCCEEDED.
   */
  let alreadyReleased = false;

  return {
    stamp,
    restoreActiveDocument: restorePreviousActive,
    async release() {
      if (alreadyReleased) return;
      alreadyReleased = true;
      /* We close ONLY what we ourselves opened, and only without saving. */
      if (stamp.wasAlreadyOpen) return;
      /* No closing at all until the document WE opened has been
       * identified unambiguously (finding #2). */
      if (nameToClose === null) return;

      /*
       * Review, round 2 (R13): between the state snapshot (`openSession`)
       * and this call, the WHOLE audit elapses — up to several minutes,
       * not milliseconds. In that time the user can quite easily close OUR
       * document and open ANOTHER one under the same name; `itemByName` on
       * its own sees no difference. So before closing we check FOUR
       * conditions — a document with that name exists, it was ALREADY
       * SAVED to disk (otherwise there's no `fullName` to check against),
       * its `fullName` matches what we opened, and it is UNCHANGED (our
       * run never writes anything, so a modified document is either
       * someone else's, or someone wrote to it; either way it must not be
       * closed). All of this is ONE state read inside JSX right before
       * closing, not a separate call to `indesign_status`: a separate call
       * would leave the same window open, just one step closer to
       * closing.
       *
       * R23: we check the RAW `fullName` captured during `openSession`
       * (`очікуванийRawFullName` — what InDesign itself returned back
       * then), NOT `docPath` (the POSIX path from the caller). Both sides
       * of this comparison are now in the SAME InDesign encoding — byte
       * equality works with no normalization inside ExtendScript at all.
       * Do NOT touch this comparison (R23, closed by re-review and
       * confirmed by measurement on the live engine): ExtendScript 4.5.6
       * has no `String.prototype.normalize`, so both sides stay
       * raw-against-raw.
       *
       * R27: `!__d.saved` and the `fullName` comparison USED TO share one
       * branch via `||` — a document that was NEVER saved to disk
       * (`saved === false`, nothing to check `fullName` against) got the
       * message "the document's path differs," even though the path was
       * irrelevant here: there was nothing to check at all. The first live
       * run already showed this for a DIFFERENT pair of conditions
       * (`!saved` and a `fullName` mismatch can both be true at once, and
       * the message only names the second) — that specific case was closed
       * by R23 (the comparison is now raw-against-raw), but the shared
       * branch remained, and would silently name the wrong reason again
       * the moment a document that was never saved shows up. Each
       * condition is now its own branch with its own name; the order
       * (saved → path → modified) is the same as it was in the `||` (JS
       * evaluates `!saved` first via short-circuiting), so behavior does
       * NOT change — only the wording of the reason changes.
       */
      const result = await callTool<{ closed: boolean; reason?: string }>(
        box,
        "indesign_run_jsx",
        toRunScript(
          `var __d = app.documents.itemByName(${JSON.stringify(nameToClose)});` +
            `if (!__d.isValid) {` +
            `  __result = {closed:false, reason:"a document with that name is no longer open"};` +
            `} else if (!__d.saved) {` +
            `  __result = {closed:false, reason:"the document was never saved to disk — there's no path to check it against, this isn't the document we opened"};` +
            `} else if (String(__d.fullName) !== ${JSON.stringify(expectedRawFullName)}) {` +
            `  __result = {closed:false, reason:"the document's path differs from what was expected — this isn't the document we opened anymore"};` +
            `} else if (__d.modified) {` +
            `  __result = {closed:false, reason:"the document has unsaved changes — our run never writes anything, so this isn't the untouched state we left"};` +
            `} else {` +
            `  __d.close(SaveOptions.NO);` +
            `  __result = {closed:true};` +
            `}`,
        ),
      );

      if (!result.closed) {
        stamp.releaseSkippedReason =
          result.reason ?? "The document failed the pre-close check — left open.";
      }
    },
  };
}
