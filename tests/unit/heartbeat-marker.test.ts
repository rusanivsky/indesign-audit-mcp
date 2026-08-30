import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndesignError } from "../../src/bridge/errors.js";
import { LIVE_WRITE_MARKER, assertNoLiveWrite } from "../../src/bridge/heartbeat.js";

/*
 * THE BRANCH THAT LOOKED FOR A STRING NOBODY EVER WROTE.
 *
 * `runWrite` throws kind "busy" for two opposite situations:
 *
 *   1. `assertNoLiveWrite` refuses BEFORE InDesign is touched, because a
 *      previous write is still live. Nothing has changed, and NO backup copy
 *      has been made — the call never got that far.
 *   2. `runJsx` was killed on timeout mid-write. The edits may well have
 *      landed, and a copy DOES exist in `_backups/`.
 *
 * `kind` cannot tell them apart, so `corrections_apply` discriminates on the
 * message. It searched for the phrase "a write is already in progress" — which
 * `assertNoLiveWrite` never produced, and which appeared nowhere else in the
 * repository. `!message.includes(...)` was therefore ALWAYS true, so BOTH cases
 * took branch 2's text.
 *
 * The damage is what that text asserts. `describeApplyTimeout()` tells the
 * operator the edits "may have been applied … after this error" and that a copy
 * of the document from before the edits "was saved in the `_backups/` folder".
 * For a refused write both statements are false, and the genuinely useful
 * hint — which handler is running, into which document, for how long, and the
 * path of the stale trace to delete — was thrown away.
 *
 * A green suite could never show this: no test exercised the refusal path
 * through the handler, and the two strings lived in files that never referenced
 * each other. The fix is a shared exported constant; these tests pin that the
 * thrower still produces it, so retyping it in either place fails here.
 */

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "idmcp-hb-"));
  process.env.INDESIGN_MCP_HOME = home;
});

afterEach(() => {
  delete process.env.INDESIGN_MCP_HOME;
  rmSync(home, { recursive: true, force: true });
});

const tracePath = () => join(home, "write.heartbeat.json");

/** A trace that looks exactly like a write still running right now. */
function writeLiveTrace(now: number): void {
  writeFileSync(
    tracePath(),
    JSON.stringify({
      handler: "apply_edits",
      docName: "book.indd",
      startedAt: now - 4000,
      touchedAt: now - 500,
      phase: "edits",
    }),
  );
}

describe("the live-write refusal and the branch that reads it", () => {
  it("throws when a write is genuinely live", async () => {
    const now = Date.now();
    writeLiveTrace(now);
    await expect(assertNoLiveWrite(tracePath(), now)).rejects.toThrow(IndesignError);
  });

  it("the thrown message CONTAINS the shared marker — the whole point of the constant", async () => {
    const now = Date.now();
    writeLiveTrace(now);
    const err = await assertNoLiveWrite(tracePath(), now).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IndesignError);
    expect((err as IndesignError).message).toContain(LIVE_WRITE_MARKER);
  });

  it("the marker is not so generic that it would match any busy error", () => {
    /* The constant has to be specific enough to DISCRIMINATE. If it ever became
     * something like "InDesign", the timeout error would match it too and the
     * branch would invert — failing loudly here instead of silently in the
     * operator's report. */
    const timeoutish = new IndesignError(
      "busy",
      "InDesign did not respond within 180 s while WRITING the edits.",
      "hint",
    );
    expect(timeoutish.message).not.toContain(LIVE_WRITE_MARKER);
  });

  it("the refusal names what the operator actually needs: handler, document, and the trace to delete", async () => {
    /* This is the content that the mislabelling discarded. */
    const now = Date.now();
    writeLiveTrace(now);
    const err = (await assertNoLiveWrite(tracePath(), now).catch((e: unknown) => e)) as IndesignError;
    expect(err.message).toContain("apply_edits");
    expect(err.message).toContain("book.indd");
    expect(err.hint).toContain(tracePath());
  });

  it("NEGATIVE CONTROL: a stale trace does not refuse, so the marker cannot fire spuriously", async () => {
    /* Without this, an `assertNoLiveWrite` that threw unconditionally would
     * satisfy every assertion above while blocking every write in the project. */
    const now = Date.now();
    writeFileSync(
      tracePath(),
      JSON.stringify({
        handler: "apply_edits",
        docName: "book.indd",
        startedAt: now - 600_000,
        touchedAt: now - 600_000,
        phase: "edits",
      }),
    );
    await expect(assertNoLiveWrite(tracePath(), now)).resolves.toBeUndefined();
  });

  it("NEGATIVE CONTROL: no trace at all does not refuse", async () => {
    await expect(assertNoLiveWrite(tracePath(), Date.now())).resolves.toBeUndefined();
  });
});
