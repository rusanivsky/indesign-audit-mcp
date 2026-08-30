import { expect, it, vi } from "vitest";
import type { Tools } from "../../src/tools/shared.js";

/*
 * THE REFUSAL THAT COULD NOT BE ACTED ON.
 *
 * `pagination_audit` declares its families through three TOP-LEVEL OBJECT
 * parameters (`folio`, `contents`, `runningHead`), each carrying the style names
 * that identify the family in this particular edition. Declaring none of them is
 * refused on purpose: the measurement costs a pass over the whole document and
 * could only return emptiness.
 *
 * The refusal was correct; its WORDING was not, and that was measured against a
 * live document on 2026-08-26. The message read "name folio, contents,
 * runningHead, or several" — which names the three VALUES but neither the
 * parameters that carry them nor their shape. A caller reads that as a list of
 * names to pass and sends `families: ["folio", …]`.
 *
 * That guess fails SILENTLY. `inputSchema` is a `z.ZodRawShape`, so the SDK
 * validates with a non-strict `z.object()`: a parameter the tool does not know is
 * stripped before the handler ever sees it. `families` therefore arrives as
 * nothing at all, the same gate fires, and THE SAME MESSAGE COMES BACK. Nothing
 * in the second reply distinguishes "you named no family" from "you named them in
 * a parameter that does not exist", so the retry loop cannot converge — the
 * caller has no way to learn what to change.
 *
 * The fix is the message, not the gate: it now prints the three shapes literally
 * and says outright that an unknown parameter is discarded without an error.
 * These tests pin the parts a future edit must not drop — a message that once
 * again names only the values would restore exactly the dead end above.
 */

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type AnyHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const { runJsxMock } = vi.hoisted(() => ({ runJsxMock: vi.fn() }));
vi.mock("../../src/bridge/runner.js", () => ({ runJsx: runJsxMock }));
vi.mock("../../src/bridge/envelope.js", () => ({ runWrite: vi.fn() }));

const { registerPaginationTools } = await import("../../src/tools/pagination.js");

function auditHandler(): AnyHandler {
  let captured: AnyHandler | null = null;
  const fake = {
    registerTool(name: string, _cfg: unknown, h: AnyHandler) {
      if (name === "pagination_audit") captured = h;
    },
  } as unknown as Tools;
  registerPaginationTools(fake);
  if (!captured) throw new Error("pagination_audit was not registered");
  return captured;
}

async function refusalText(args: Record<string, unknown>): Promise<string> {
  runJsxMock.mockReset();
  const res = await auditHandler()(args);
  /* The document must never have been touched: the whole point of this gate is
   * that it refuses BEFORE the pass that costs a document read. Without this
   * assertion the test would still pass if the gate moved after the measurement. */
  expect(runJsxMock).not.toHaveBeenCalled();
  expect(res.isError).toBe(true);
  const first = res.content[0];
  if (!first) throw new Error("the refusal carried no content block at all");
  return first.text;
}

it("refuses when no family is declared, without reading the document", async () => {
  const text = await refusalText({});
  expect(text).toContain("No family has been declared");
});

it("names all three carrying PARAMETERS, not just the family values", async () => {
  const text = await refusalText({});
  /* `folio:` with the colon — the bare word already appeared in the old, useless
   * message, so asserting on it alone would pass against the very text this
   * test exists to rule out. */
  for (const param of ["folio:", "contents:", "runningHead:"]) {
    expect(text, `the refusal does not show the parameter ${param}`).toContain(param);
  }
});

it("shows the required shape of each parameter, so the caller can build the call", async () => {
  const text = await refusalText({});
  expect(text).toContain("styleNames");
  expect(text).toContain("numberStyle");
  expect(text).toContain("levelMap");
  expect(text).toContain("headingStyles");
});

it("warns that an unknown parameter is discarded silently — the reason for the dead end", async () => {
  const text = await refusalText({});
  expect(text).toMatch(/DISCARDED WITHOUT AN ERROR/u);
  expect(text).toContain("families");
});

it("gives the SAME refusal for the plausible wrong guess — the loop this message must break", async () => {
  /* Reproduces the live call of 2026-08-26. The assertion is not that the tool
   * accepts `families` (it must not — the styles differ per edition and cannot be
   * guessed), but that the reply a caller gets after guessing actually tells them
   * the parameter does not exist. */
  const text = await refusalText({ families: ["folio", "contents", "runningHead"] });
  expect(text).toContain("There is NO parameter named");
  expect(text).toContain("styleNames");
});

it("does not refuse once a family IS declared in the real shape", async () => {
  /* The negative control on the gate itself: without it, a handler that refused
   * every call whatsoever would satisfy every assertion above. */
  runJsxMock.mockReset();
  runJsxMock.mockRejectedValue(new Error("bridge reached — the gate let this through"));
  const res = await auditHandler()({ folio: { styleNames: ["Numbering L"] } });
  expect(runJsxMock).toHaveBeenCalled();
  const first = res.content[0];
  if (!first) throw new Error("the reply carried no content block at all");
  expect(first.text).not.toContain("No family has been declared");
});
