import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { IndesignError } from "../bridge/errors.js";
import { serialise } from "../serialise.js";

/**
 * A structural interface instead of `= McpServer`. The reason is the preflight
 * audit CLI: it must call THE SAME handlers in-process rather than bring up a
 * server. `McpServer` satisfies this type structurally (verified by a probe with
 * a negative control, spec §0.2), so `src/server.ts` does not change.
 *
 * Duplicating the orchestration in the CLI was not an option: in Phase 5 that
 * very duplication produced the same bug in five places.
 *
 * WHY `registerTool` is a GENERIC method rather than a plain non-generic
 * signature like `(...args: never[]) => unknown`, taken literally from the first
 * draft of the brief (proven by probe, three attempts at simpler forms):
 *
 *   1. `(...args: never[]) => unknown` — assignability of `McpServer` to this
 *      type DOES work (a `never[]` rest parameter is the known trick for
 *      "accept a function with any number of arguments"), BUT that same trick
 *      breaks compilation INSIDE each of the 22 tools: when
 *      `server.registerTool(name, config, async (args) => {...})` is checked
 *      against such a type, TypeScript contextually types the unannotated
 *      `args` parameter as `never` (the element of `never[]`) — and any
 *      property access (`args.nearMissThresholdPt`) becomes
 *      `TS2339: Property … does not exist on type 'never'`.
 *   2. `(...args: any[]) => unknown` — the parameter's contextual type becomes
 *      `any`, the first property access is no longer an error, but the type is
 *      lost down the chain: `findingIds.filter((id) => …)`, where `findingIds`
 *      is `any`, trips `TS7006` on the `id` parameter, because calling a method
 *      on `any` does not contextually type the callback.
 *   3. A bespoke generic type `<Shape>(args: z.infer<z.ZodObject<Shape>>) => unknown`
 *      restores the types INSIDE the tools but BREAKS assignability of
 *      `McpServer` — comparing two GENERIC signatures makes TypeScript require
 *      a structural match of the type-parameter list itself, and the real
 *      `registerTool` has TWO (`OutputArgs`, `InputArgs`), not one.
 *
 * The working option is to take the REAL callback response type from the SDK,
 * `ToolCallback<InputArgs>` (a public export of `server/mcp.js`, not the
 * `McpServer` class itself), and bind `InputArgs` to `z.ZodRawShape` (a zod
 * type, not an SDK-internal one). That is at once (a) the only parameter that
 * structurally matches the real `registerTool` for assignability, and (b) what
 * gives every tool the same type inference from `inputSchema` as before — not
 * one `src/tools/*.ts` file had to change.
 */
export interface Tools {
  registerTool<InputArgs extends z.ZodRawShape | undefined = undefined>(
    name: string,
    config: { inputSchema?: InputArgs } & Record<string, unknown>,
    handler: ToolCallback<InputArgs>,
  ): unknown;
}

/*
 * The response serialiser lives in the leaf module `src/serialise.ts` — that is
 * also where it is explained why it is compact and why it is a separate module.
 * Here it is merely re-exported so that both the tests and the remaining tools
 * take it from a single place.
 */
export { serialise } from "../serialise.js";

/** A single response format: JSON inside a text block. */
export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: serialise(data) }] };
}

/**
 * A response carrying a RASTER. A separate helper rather than a flag on `ok()`,
 * because every one of the existing tools depends on `ok()`'s present shape.
 *
 * The image comes FIRST on purpose: the client renders content blocks in order,
 * so the numbers read as a caption underneath the picture rather than above it.
 */
export function okImage(base64: string, mimeType: string, data: unknown) {
  return {
    content: [
      { type: "image" as const, data: base64, mimeType },
      { type: "text" as const, text: serialise(data) },
    ],
  };
}

/**
 * A field shared by the three writing tools: which document the caller MEANS.
 *
 * User decision of 2026-08-05 — optional, not mandatory. The chain
 * "measure → reconcile → `apply.jsx:263`" is closed even without it: an edit
 * physically cannot land in a document other than the one measured. What was
 * missing was the ability to say IN ADVANCE which document is meant: if the
 * user's working book happens to be active, the tools would quietly operate on
 * it, and that could only be discovered after the fact, from `docName` in the
 * response.
 *
 * It was deliberately not made mandatory: that would break every existing call
 * and force the caller to look up the name first every time — for the sake of a
 * protection that already works in the ordinary case.
 */
export const EXPECTED_DOC_NAME_FIELD = z
  .string()
  .optional()
  .describe(
    "Name of the document the write is intended for. If named and it does not match the " +
      "document the tool has just measured, the write is not performed at all. " +
      "If not named, the tool writes to the document it measured (the ordinary behaviour).",
  );

/**
 * Reconciles the document named by the caller against the one actually measured.
 *
 * Thrown BEFORE any write and before the copy is made — so refusing here costs
 * exactly nothing. The measured name comes from the same read that the edits are
 * later built from, so the reconciliation covers precisely the data that will go
 * into `apply_edits`.
 */
export function assertExpectedDoc(measured: string, requested: string | undefined): void {
  if (requested !== undefined && requested !== measured) {
    throw new IndesignError(
      "wrong-document",
      `You named the document “${requested}”, but “${measured}” was measured. Nothing has been changed.`,
      "Check which document is active in InDesign (indesign_status) and either make " +
        "the intended one active, or drop expectedDocName to work with the active one.",
    );
  }
}

/** The error is returned as text with a hint, not as a protocol exception. */
export function fail(err: unknown) {
  if (err instanceof IndesignError) {
    /*
     * ЧАСТКОВИЙ ЗВІТ ДОДАЄТЬСЯ ДО ТЕКСТУ, коли він є.
     *
     * `runWrite` чіпляє до помилки той самий об'єкт, що його `apply.jsx`
     * накопичував до моменту збою: applied/skipped/failed. Без цього блоку
     * він доїжджав би до `fail()` і мовчки гинув тут — оператор бачив би
     * «якісь правки могли лягти», маючи поруч поіменний перелік тих, що
     * лягли напевно.
     *
     * Серіалізуємо ТИМ САМИМ `serialise`, що й успішні відповіді: інакше
     * помилковий шлях мав би власний формат, і його довелося б окремо
     * тримати в синхроні.
     */
    const partial =
      err.payload === undefined ? "" : `\n\nWhat had already happened:\n${serialise(err.payload)}`;
    return {
      isError: true,
      content: [{ type: "text" as const, text: `${err.message}

What to do: ${err.hint}${partial}` }],
    };
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: String(err instanceof Error ? err.message : err) }],
  };
}
