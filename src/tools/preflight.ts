import { z } from "zod";
import { runJsx } from "../bridge/runner.js";
import { buildReport } from "../preflight/summarise.js";
import type { PreflightMeasure } from "../preflight/types.js";
import { fail, ok, type Tools } from "./shared.js";

/**
 * Preflight on a 196-page book with links in a cloud folder is not instant.
 * The ceiling is generous; the real elapsed time is written into the response
 * so that it can be narrowed by MEASUREMENT rather than by guesswork.
 */
const PREFLIGHT_TIMEOUT_MS = 180_000;

/**
 * Headroom between the JSX's own wait and the outer AppleScript timeout.
 *
 * Same idea as `PROCESS_KILL_GRACE_MS` in `runner.ts`: when both limits are
 * equal, the outer one fires first (or at the same moment), and the JSX's OWN
 * message — the one that explains why preflight did not finish in time — NEVER
 * appears. The operator sees a faceless "AppleEvent timed out" instead.
 */
const PREFLIGHT_WAIT_GRACE_MS = 15_000;

/** How long the JSX itself waits. Below the outer timeout by exactly the headroom above. */
const PREFLIGHT_WAIT_SECONDS = (PREFLIGHT_TIMEOUT_MS - PREFLIGHT_WAIT_GRACE_MS) / 1000;

export function registerPreflightTools(server: Tools): void {
  server.registerTool(
    "preflight_document",
    {
      title: "Document preflight",
      description:
        "Runs InDesign's NATIVE preflight and returns its findings, laid out by " +
        "category and rule, with pages and the Problem/Fix text from the application itself. " +
        "READ-ONLY: it creates and changes no profiles and does not touch the document. " +
        "THE MAIN THING TO UNDERSTAND ABOUT THE RESPONSE: \"0 violations\" here does NOT mean " +
        "\"the layout is clean\". The [Basic] profile has 38 rules, six of which are enabled — " +
        "measured on a real book on 2026-08-07. Among the disabled ones is ADBE_ImageResolution, " +
        "meaning low image resolution is by default NOT checked at all. That is why the response " +
        "always carries rulesEnabled/rulesDisabled and the named enabledRuleIds/disabledRuleIds: " +
        "without them a zero cannot be told apart from \"we never asked\". " +
        "WHAT THE TOOL DOES NOT DO: it does not enable rules (that is done inside InDesign) and " +
        "does not invent resolution thresholds — those depend on the print shop and are a human " +
        "decision, not a tool's. It does not replace layout_audit, styles_audit or " +
        "pagination_audit: preflight judges the TECHNICAL fitness of the file (fonts, links, " +
        "overset), not the systematic quality of the layout. " +
        "RESPONSE FIELDS: caveat — a mandatory sentence built from THIS measurement " +
        "(the profile, the rule counts, whether ADBE_ImageResolution really is disabled, whether " +
        "live preflight is off) without which a zero reads wrongly; findings — category → " +
        "rule → occurrences (page, object, description, details); occurrenceCount — " +
        "the number of OCCURRENCES, not of rules; occurrencesTruncated {shown, total} — present " +
        "only when the listing was cut by the ceiling; rulesEnabled/rulesDisabled and the named " +
        "enabledRuleIds/disabledRuleIds — WHAT was measured with; preflightOff — whether live " +
        "preflight is disabled in the document; profileName/workingProfile — which profile was " +
        "measured with and which is the document's working one; availableProfiles — what there is " +
        "to choose from; scope — the extent of the check; shapeRecognised, rowsSeen/rowsParsed, " +
        "pairsSeen/pairsParsed — counters of the parse itself (zero findings with " +
        "shapeRecognised=false means \"we did not read it\", not \"it is clean\"); processRemoved — " +
        "whether the preflight process was cleaned up afterwards; waitTimedOut — if true, the " +
        "list of findings is INCOMPLETE (the findings themselves are still real); waitPolarity — " +
        "not null means waitForProcess returned a NON-boolean, i.e. waitTimedOut above was set " +
        "conservatively rather than measured; elapsedMs — the run time.",
      inputSchema: {
        profileName: z
          .string()
          .optional()
          .describe(
            "Profile name. Without this field the DOCUMENT'S WORKING PROFILE is used " +
              "(doc.preflightOptions.preflightWorkingProfile) — that is, the reference is derived " +
              "from the document rather than fixed as a constant. If no profile by that name " +
              "exists, the tool refuses and lists the available ones instead of returning an " +
              "empty report.",
          ),
      },
    },
    async ({ profileName }) => {
      try {
        const started = Date.now();
        const measure = await runJsx<PreflightMeasure>(
          "preflight_measure",
          { profileName, waitSeconds: PREFLIGHT_WAIT_SECONDS },
          { timeoutMs: PREFLIGHT_TIMEOUT_MS },
        );
        const report = buildReport(measure);
        return ok({ ...report, elapsedMs: Date.now() - started });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
