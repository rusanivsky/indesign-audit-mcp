#!/usr/bin/env node
/**
 * Task P — the audit as ONE file that can be carried over to another Mac.
 *
 *     node scripts/build-audit-bundle.mjs
 *     node dist/indesign-audit.mjs --config <config>.json --out report.html
 *
 * No `node_modules`, no `npm install`, no network.
 *
 * WHY THIS IS EVEN POSSIBLE — a measured fact, not a hope: the import
 * closure of `dist/cli/audit.js` is 120 files and EXACTLY ONE external
 * module, `zod`. Not the MCP SDK (its types were erased at compile time) and
 * not `pdfjs-dist`. There's no native dependency anywhere in the closure, so
 * bundling into a single file doesn't run into a `.node` binary.
 *
 * THE DEPENDENCY ON `esbuild` IS TRANSITIVE, AND THAT'S DELIBERATE. It's
 * carried in by `tsx` and `vitest`, so the brief requires no new
 * dependency. But the transitivity itself is fragile: if `tsx`/`vitest`
 * ever leave the project, this build will break — and it will break
 * LOUDLY, with a clear message below, not with a silent, broken bundle.
 */
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUTFILE = join(DIST, "indesign-audit.mjs");

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch (err) {
    throw new Error(
      "esbuild недоступний. Він приїздить транзитивно з `tsx`/`vitest`; якщо їх " +
        "прибрали, додайте esbuild у devDependencies явно. Первинна помилка: " +
        String(err && err.message ? err.message : err),
    );
  }
}

async function mustExist(path, what) {
  try {
    await stat(path);
  } catch {
    throw new Error(
      `${what} не знайдено за шляхом ${relative(ROOT, path)}. Спершу зберіть проєкт: npm run build`,
    );
  }
}

async function main() {
  await mustExist(join(DIST, "cli", "audit.js"), "Точку входу аудиту");
  await mustExist(join(DIST, "embedded", "assets.js"), "Реєстр вшитих активів");

  /*
   * We inline ALL files from `dist/jsx`, not just the `CORE_MODULES`
   * list. `jsxModules()` adds `_fixtures.jsx` based on an environment
   * variable, and a bundle missing that file would fail exactly when
   * it's asked for — i.e. at the worst possible moment. The cost of
   * completeness is a few kilobytes.
   */
  const jsxDir = join(DIST, "jsx");
  await mustExist(jsxDir, "Теку зібраних JSX");
  const jsxNames = (await readdir(jsxDir)).filter((n) => n.endsWith(".jsx")).sort();
  if (jsxNames.length === 0) throw new Error(`У ${relative(ROOT, jsxDir)} немає жодного .jsx`);

  const assets = [];
  for (const name of jsxNames) {
    assets.push([`jsx/${name}`, await readFile(join(jsxDir, name), "utf8")]);
  }
  const templatePath = join(DIST, "cli", "template", "report.html");
  await mustExist(templatePath, "Шаблон звіту");
  assets.push(["cli/template/report.html", await readFile(templatePath, "utf8")]);

  /*
   * THE EXECUTION ORDER HERE IS NOT COSMETIC. Static ESM imports are
   * evaluated BEFORE a module's body runs, so `import "…/audit.js"`
   * would launch the CLI before even one `registerAsset` had run — and
   * the bundle would then read assets from disk, which doesn't exist on
   * someone else's machine. A dynamic `await import` after registration
   * is the only form that gives the needed ordering.
   */
  const entry = [
    `import { registerAsset } from ${JSON.stringify(join(DIST, "embedded", "assets.js"))};`,
    ...assets.map(([k, v]) => `registerAsset(${JSON.stringify(k)}, ${JSON.stringify(v)});`),
    `await import(${JSON.stringify(join(DIST, "cli", "audit.js"))});`,
    "",
  ].join("\n");

  const esbuild = await loadEsbuild();
  const tmp = await mkdtemp(join(tmpdir(), "idmcp-bundle-"));
  const entryPath = join(tmp, "entry.mjs");
  try {
    await writeFile(entryPath, entry, "utf8");
    await esbuild.build({
      entryPoints: [entryPath],
      outfile: OUTFILE,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node18",
      banner: { js: "#!/usr/bin/env node" },
      logLevel: "warning",
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  await chmod(OUTFILE, 0o755);
  const bytes = (await stat(OUTFILE)).size;
  process.stdout.write(
    `${relative(ROOT, OUTFILE)}\n` +
      `  вшито активів: ${assets.length} (${jsxNames.length} jsx + 1 шаблон)\n` +
      `  розмір: ${(bytes / 1024 / 1024).toFixed(2)} МБ\n`,
  );

  await зібратиТекуПереносу(bytes);
}

/**
 * The folder that gets carried over to another Mac IN FULL.
 *
 * A single file isn't enough: on its own, the bundle only runs from a
 * terminal, and only when the operator remembers the path to the config.
 * So a launcher (double-click in Finder), edition configs, and a short
 * note on limitations are placed alongside it. The launcher looks for
 * the bundle RIGHT NEXT TO ITSELF — which is exactly why the folder can
 * be placed anywhere, on any machine.
 *
 * Assembled FRESH on every build, not copied by hand: a copy updated by
 * hand goes stale silently — and the operator ends up running an old
 * version without knowing it. It's the same flaw as a stale comment,
 * only more expensive.
 */
async function зібратиТекуПереносу(bundleBytes) {
  const тека = join(DIST, "indesign-audit");
  await rm(тека, { recursive: true, force: true });
  await mkdir(join(тека, "configs"), { recursive: true });

  await copyFile(OUTFILE, join(тека, "indesign-audit.mjs"));
  await chmod(join(тека, "indesign-audit.mjs"), 0o755);

  const запускач = join(ROOT, "Audit.command");
  await mustExist(запускач, "Запускач Audit.command");
  await copyFile(запускач, join(тека, "Audit.command"));
  await chmod(join(тека, "Audit.command"), 0o755);

  let конфігів = 0;
  const звідки = join(ROOT, "configs");
  for (const ім of (await readdir(звідки)).filter((n) => n.endsWith(".json")).sort()) {
    await copyFile(join(звідки, ім), join(тека, "configs", ім));
    конфігів++;
  }

  const довідка = join(ROOT, "docs", "audit-bundle-deployment.md");
  try {
    await copyFile(довідка, join(тека, "HOW-TO-USE.md"));
  } catch {
    /* The note isn't critical for running — but it's better to flag its absence. */
    process.stdout.write(
      "  УВАГА: docs/audit-bundle-deployment.md не знайдено, довідки в теці не буде\n",
    );
  }

  process.stdout.write(
    `\n${relative(ROOT, тека)}/  ← ЦЮ ТЕКУ ПЕРЕНОСИТИ ЦІЛКОМ\n` +
      `  Audit.command        подвійний клік у Finder\n` +
      `  indesign-audit.mjs   сам аудит, ${(bundleBytes / 1024 / 1024).toFixed(2)} МБ\n` +
      `  configs/             ${конфігів} конфіг(и) видань\n` +
      `  HOW-TO-USE.md        межі, яких пакування не знімає\n`,
  );
}

main().catch((err) => {
  process.stderr.write(String(err && err.message ? err.message : err) + "\n");
  process.exit(1);
});
