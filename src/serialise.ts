/**
 * Response serialization — ONE for the whole server: both what `ok()` uses
 * to hand back data, and what every size budget weighs it with.
 *
 * COMPACT, NO INDENTATION, and that's measured, not a taste choice.
 * `JSON.stringify(data, null, 2)` bloats every response by roughly a third,
 * and the tools already pressed against the client limit are exactly the
 * ones that pay for it. Measured on the working book 2026-08-16 (196 pages),
 * with real handlers via `scripts/measure-response-size.mjs` — no mirror.
 *
 * WHY A SEPARATE LEAF MODULE, NOT A FUNCTION IN `tools/shared.ts`. The size
 * budget for `spelling_audit` (`src/spelling/report.ts`) must weigh a string
 * THE SAME WAY the server does — otherwise it trims the response to a format
 * that doesn't exist. But `tools/shared.ts` pulls in `McpServer` and `zod`,
 * while `spelling/report.ts` is plain TypeScript with no dependencies. So
 * the function lives here, and `tools/shared.ts` only re-exports it.
 *
 * HISTORY, SO IT DOESN'T REPEAT. Twice the size threshold measured the wrong
 * response: `geometry_audit` counted the report without the fields the tool
 * appends afterward (1861 B vs. the real 3758 B), and `spelling_audit`
 * counted compact CHARACTERS instead of UTF-8 bytes (a 40,000 budget vs. the
 * actual 75,754 B response). Both times the cause was the same: the
 * measurement format and the response format lived in different places and
 * drifted apart.
 */
export function serialise(data: unknown): string {
  return JSON.stringify(data);
}
