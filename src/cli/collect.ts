import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { СХЕМА_CLI_EXTRAS } from "./measure/extras.js";
import { registerBibliographyTools } from "../tools/bibliography.js";
import { registerColorTools } from "../tools/color.js";
import { registerCompositionTools } from "../tools/composition.js";
import { registerGeometryTools } from "../tools/geometry.js";
import { registerInspectTools } from "../tools/inspect.js";
import { registerMapTools } from "../tools/map.js";
import { registerPaginationTools } from "../tools/pagination.js";
import { registerPreflightTools } from "../tools/preflight.js";
import { registerRunTool } from "../tools/run.js";
import type { Tools } from "../tools/shared.js";
import { registerSpellingTools } from "../tools/spelling.js";
import { registerStatusTool } from "../tools/status.js";
import { registerStyleTools } from "../tools/styles.js";
import { registerTypographyTools } from "../tools/typography.js";

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * Out-of-schema call bounds — time, not a tool argument (H1).
 *
 * Deliberately separate from `args`: the time limit doesn't measure
 * anything and must not end up in `params.json` for JSX, nor in
 * `PassResult.args`, which the report prints as «which parameters were
 * used to measure».
 */
export interface CallLimits {
  /** Ceiling for the InDesign response for this call; its source is `Pass.timeoutHintMs`. */
  timeoutMs?: number;
}

/**
 * Handler for a SYNTHETIC entry (today the only one is `__cli_extras`):
 * besides arguments, it also accepts call bounds. It is not an MCP tool,
 * so it can't break parity with the SDK either — see `ToolEntry`.
 */
export type BridgeHandler = (
  args: Record<string, unknown>,
  limits: CallLimits,
) => Promise<ToolResult>;

/**
 * R24 (pre-flight review of a live run, 13 passes on the book): for three
 * tools whose fields carry `.default(...)` (e.g. `composition_audit` —
 * `pageWindow`, `styles_audit`/`layout_audit` — `families`), the collector
 * used to hand back `undefined` instead of the default. The cause:
 * `callTool` called the handler DIRECTLY, bypassing exactly the step where
 * the MCP SDK runs arguments through `inputSchema` and applies
 * `.default(...)`. Without `inputSchema` alongside the handler there's
 * nothing to reproduce that step with — so the box now keeps BOTH.
 *
 * H1: an entry comes in TWO kinds, and the second kind differs only by what
 * it actually is.
 *
 * - `bridge` absent (or `false`) — a real MCP tool. Its handler is called
 *   with EXACTLY one argument, same as before H1. The SDK's second
 *   positional slot is reserved for `RequestHandlerExtra`
 *   (`mcp.js:230-233`: `typedHandler(args, extra)`), so putting our own
 *   object there would slip handlers something that never exists there
 *   under the real server. That's not done here: call bounds don't reach
 *   registered tools AT ALL — each of them already holds its own limit
 *   (`COLOR_TIMEOUT_MS`, `PAGINATION_MEASURE_TIMEOUT_MS`, etc.) next to its
 *   own `runJsx`.
 * - `bridge: true` — a synthetic entry that routes the call to `runJsx`
 *   DIRECTLY. There's no tool behind it, so there's no place for its own
 *   limit to live either: the limit has to come from outside, from the pass
 *   (`Pass.timeoutHintMs`). That's exactly why `extras` used to fail at the
 *   30-second `DEFAULT_TIMEOUT`, while the plan declared 180.
 */
export type ToolEntry =
  | { inputSchema?: z.ZodRawShape; handler: ToolHandler; bridge?: false }
  /*
   * I7: a synthetic entry ALSO CARRIES A SCHEMA. This used to say
   * `inputSchema?: undefined` — the type forbade having one, and combined
   * with the exemption in `reconcileWithToolSchemas` this left
   * `extras`/`sequences` (six of the fourteen §10 control numbers) with no
   * schema check at all. «Not an MCP tool» is a truth about TRANSPORT, not
   * a reason to have no input shape: it does have one, read by
   * `src/jsx/cli-extras.jsx`.
   */
  | { inputSchema?: z.ZodRawShape; handler: BridgeHandler; bridge: true };
export type ToolBox = Map<string, ToolEntry>;

/**
 * Mutating tools are NOT part of the audit (spec §2): the run is entirely
 * read-only. The list is explicit, not «everything that isn't *_apply» —
 * because a silent rename must not smuggle an entry into the read-only run.
 */
const MUTATING = new Set([
  "typography_apply",
  "pagination_apply",
  "composition_apply",
  "corrections_apply",
  "corrections_plan",
]);

/**
 * Collects handlers without spinning up an MCP server. The registrars don't
 * know they're not facing a real server: `registerTool` is all they need.
 *
 * R1 (pre-flight review of the plan): the base list of registrars was
 * incomplete. `registerRunTool` gives `indesign_run_jsx` — without it Task 4
 * (`openSession`, opening and closing the document) throws «not found among
 * collected». `registerInspectTools` gives `doc_overview`, needed as the
 * first pass (spec §4.3).
 */
export function collectTools(): ToolBox {
  const box: ToolBox = new Map();
  const collector: Tools = {
    registerTool(name, config, handler) {
      if (MUTATING.has(name)) return undefined;
      box.set(name, {
        inputSchema: config.inputSchema,
        handler: handler as unknown as ToolHandler,
      });
      return undefined;
    },
  };

  registerStatusTool(collector);
  registerInspectTools(collector);
  registerRunTool(collector);
  registerMapTools(collector);
  registerTypographyTools(collector);
  registerCompositionTools(collector);
  registerStyleTools(collector);
  registerPaginationTools(collector);
  registerPreflightTools(collector);
  registerBibliographyTools(collector);
  registerSpellingTools(collector);
  registerGeometryTools(collector);
  registerColorTools(collector);

  /*
   * R2: `__cli_extras` is a JSX handler (written by Task 8), not an MCP
   * tool. `callTool` only looks in this box, so without the synthetic entry
   * the Task 5 pass (`tool: "__cli_extras"`) would throw «not found among
   * collected». The entry just routes the call to `runJsx`, so the pass
   * runner (Task 6) stays uniform and doesn't need a separate branch for
   * the extra measurement.
   */
  box.set("__cli_extras", {
    /*
     * I7: the schema comes from a SINGLE source of truth, `СХЕМА_CLI_EXTRAS`
     * next to the output shape (`src/cli/measure/extras.ts`). It didn't
     * exist here at all before («a synthetic entry isn't an MCP tool»), and
     * that very silence left a typo in the key (`bodyTextStyle`) unnoticed
     * all the way to the report itself: «Примусових розривів: 402, з них в
     * основному тексті 0». Now the extra-measurement arguments go through
     * the same parsing as any tool's arguments (R24), and stage 1 checks the
     * family shape with `.strict()` before InDesign is even touched.
     */
    inputSchema: СХЕМА_CLI_EXTRAS,
    bridge: true,
    /*
     * H1: `timeoutMs` comes from the call bounds, not from a number written
     * here. A number here would be a SECOND source of truth alongside
     * `timeoutHintMs` in the plan — and in this project two sources of truth
     * have already diverged before (`nearMissPt`/`nearMissThresholdPt`). If
     * bounds aren't named, the bridge's `DEFAULT_TIMEOUT` is what remains —
     * i.e. exactly the behavior that existed before H1, and no caller
     * outside the pass runner notices it.
     */
    handler: async (args, limits) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await runJsx("__cli_extras", args, { timeoutMs: limits.timeoutMs })),
        },
      ],
    }),
  });

  return box;
}

/** Arguments after the schema — together with a trace of where each number came from. */
interface ParsedArgs {
  /** What actually goes to the handler. */
  args: Record<string, unknown>;
  /**
   * Keys whose value was supplied by the tool's schema, not the caller (R28).
   * Order matches the parsed object, i.e. the declaration order in the schema.
   */
  defaulted: string[];
}

/**
 * Runs the arguments through the SAME schema the MCP SDK would apply itself —
 * `z.object(inputSchema).safeParseAsync(args)`. That's also where
 * `.default(...)` comes from: without this step a defaulted field not named
 * by the caller would stay `undefined` instead of its default value (R24 —
 * found by a live run: `composition_audit` without `pageWindow` failed with
 * `pageWindows: розмір вікна мусить бути цілим ≥ 1, а прийшло undefined`).
 *
 * With no schema (`inputSchema === undefined`) — pass through unchanged:
 * that's how the MCP SDK behaves too, where `if (!tool.inputSchema) return
 * undefined` (`mcp.js:167-169`). The only such entry here is the synthetic
 * `__cli_extras`.
 *
 * An EMPTY schema (`{}`) is NOT a pass-through (R24, minor M1). The SDK
 * stores it via `getZodSchemaObject` right at registration (`mcp.js:611`),
 * and `isZodRawShapeCompat` accepts an empty object as a valid raw shape
 * (`mcp.js:850-853`) — so `tool.inputSchema` becomes a real `z.object({})`,
 * `if (tool.inputSchema)` is true, and the arguments go through parsing that
 * DROPS every unknown key. Same here: `indesign_status` and `doc_overview`
 * (`inputSchema: {}`) get exactly `{}`, whatever the caller sends. There's
 * no consequence for today's passes (the CLI sends them `{}`), but this was
 * the last spot where the «CLI measures with the same code as MCP» parity
 * (spec §0.2) didn't hold.
 *
 * `safeParseAsync`, not `safeParse` (R24, minor M2): the SDK parses
 * asynchronously (`mcp.js:174`). There are zero async `refine`/
 * `superRefine`/`transform` in `src/tools/` today, so there's no behavioral
 * difference right now — but synchronous parsing of such a schema throws a
 * runtime error «Encountered Promise during synchronous parse» instead of
 * parsing the arguments.
 *
 * The validation error names BOTH the tool AND the field (requirement 2) —
 * rather than dumping a raw `ZodError` deep into the call.
 */
async function parseToolArgs(
  name: string,
  inputSchema: z.ZodRawShape | undefined,
  args: Record<string, unknown>,
): Promise<ParsedArgs> {
  if (inputSchema === undefined) {
    return { args, defaulted: [] };
  }
  const result = await z.object(inputSchema).safeParseAsync(args);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"} — ${issue.message}`)
      .join("; ");
    throw new Error(`Tool "${name}": invalid arguments. ${issues}`);
  }
  const parsed = result.data as Record<string, unknown>;
  /*
   * R28: a key that CAME OUT of the schema with a value, even though it had
   * NO value on the way IN, was filled in by a default. This is an
   * observation, not new knowledge about the schemas: the list is derived
   * purely by comparison, and the parsing itself stays untouched.
   *
   * The question is asked about the INPUT value (`args[k] === undefined`),
   * NOT the output value. Otherwise the hardest case would get confused: a
   * person wrote a number in the config that HAPPENS TO MATCH the default.
   * On output both cases produce the same object — only the input tells
   * them apart. zod itself asks the same question: `.default(...)` fires
   * exactly when the input is `undefined`.
   */
  const defaulted = Object.keys(parsed).filter((k) => args[k] === undefined);
  return { args: parsed, defaulted };
}

/** The tool's response together with a trace of how its arguments were assembled. */
export interface ToolCallTrace<T> {
  data: T;
  /** The arguments the handler actually ran with — after the schema. */
  args: Record<string, unknown>;
  /** Keys of `args` whose value was supplied by the tool's schema, not the caller (R28). */
  defaulted: string[];
}

/**
 * Calls the handler and parses its response. The response format is the
 * same `ok()`/`fail()` from `tools/shared.ts`: JSON in a text block.
 */
export async function callTool<T>(
  box: ToolBox,
  name: string,
  args: Record<string, unknown>,
  limits: CallLimits = {},
): Promise<T> {
  return (await callToolTraced<T>(box, name, args, limits)).data;
}

/**
 * Same as `callTool`, but also returns the argument trace — so the report
 * can say which numbers the person chose and which the tool assumed
 * (R28 ruling, spec §8: a pass is printed «with the number it measured, and
 * the parameters it measured with»). The tool call itself doesn't change in
 * ANY way: `callTool` is the same function with the trace stripped off.
 */
export async function callToolTraced<T>(
  box: ToolBox,
  name: string,
  args: Record<string, unknown>,
  limits: CallLimits = {},
): Promise<ToolCallTrace<T>> {
  const entry = box.get(name);
  if (entry === undefined) {
    throw new Error(`Tool "${name}" is not among the collected ones.`);
  }
  const { args: parsedArgs, defaulted } = await parseToolArgs(name, entry.inputSchema, args);
  /*
   * H1: call bounds are received ONLY by the synthetic bridge. A call to a
   * registered tool stays byte-for-byte the same as before H1 — one
   * positional argument — so as not to occupy the slot the MCP SDK reserves
   * for `RequestHandlerExtra` (`mcp.js:230-233`).
   */
  const res =
    entry.bridge === true
      ? await entry.handler(parsedArgs, limits)
      : await entry.handler(parsedArgs);
  const text = res.content[0]?.text ?? "";
  if (res.isError === true) throw new Error(text);
  return { data: JSON.parse(text) as T, args: parsedArgs, defaulted };
}
