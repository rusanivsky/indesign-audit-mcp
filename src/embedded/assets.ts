/**
 * Registry of assets EMBEDDED IN THE BUNDLE.
 *
 * The audit reads two things off disk outside the code: JSX fragments (`dist/jsx/*.jsx`,
 * which the bridge concatenates and sends to InDesign) and the report template
 * (`dist/cli/template/report.html`). As long as they sit as separate files,
 * "a single file that carries over to another Mac" is impossible.
 *
 * IN A REGULAR BUILD THIS REGISTRY IS EMPTY, and both read sites take the
 * file off disk, same as before. It is populated ONLY by the bundle preamble that
 * `scripts/build-audit-bundle.mjs` generates. In other words, embedding is an additional
 * path, not a replacement of the existing one: `npm run build`, the tests, and `dist/cli/audit.js`
 * behave exactly as they did before this change.
 *
 * The key is the path relative to `dist/`: `jsx/_core.jsx`, `cli/template/report.html`.
 * The exact path the asset would live at on disk, so the mapping reads
 * without translation.
 */
const registry = new Map<string, string>();

export function registerAsset(name: string, contents: string): void {
  registry.set(name, contents);
}

/** `null` — the asset isn't embedded; the caller must read it off disk. */
export function readAsset(name: string): string | null {
  return registry.get(name) ?? null;
}

/** For diagnostics and tests: whether this is a bundle at all. */
export function embeddedAssetNames(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Test-only: the registry is module-level state, and a test that filled it
 * would otherwise leak into the next one.
 */
export function clearAssetsForTest(): void {
  registry.clear();
}
