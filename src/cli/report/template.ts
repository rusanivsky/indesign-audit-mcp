import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAsset } from "../../embedded/assets.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The template is deliberately vendored into the repo: the CLI has no
 * right to read `~/.claude/skills/print-audit-report/` — on another
 * machine that path doesn't exist (spec §3, §7). The `cli-template.test.ts`
 * test compares the vendored copy against the skill's copy, so a
 * divergence fails a test instead of silently going stale.
 *
 * In the built package the template lives under `dist/cli/template/` —
 * copied there by `npm run copy:jsx` (extended to cover this folder).
 */
export function templatePath(): string {
  return join(HERE, "..", "template", "report.html");
}

/**
 * In the bundle the template is embedded, and there `templatePath()` would
 * point to a folder that doesn't exist on another machine. Disk remains a
 * fallback path, not the only one — and that's exactly why
 * `templatePath()` is NOT changed: `cli-template.test.ts` compares the
 * vendored copy against the skill's copy through it, and that guard has to
 * stay in force.
 */
export function loadTemplate(): string {
  const embedded = readAsset("cli/template/report.html");
  if (embedded !== null) return embedded;
  return readFileSync(templatePath(), "utf8");
}
