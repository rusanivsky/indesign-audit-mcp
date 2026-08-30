import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PACKAGE_VERSION } from "../../src/version.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("версія оголошена в одному місці", () => {
  it("PACKAGE_VERSION дорівнює полю version у package.json", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });

  it("сервер MCP не має власного числа версії", () => {
    /* Саме цей рядок і розходився: клієнт показує версію з рукостискання, тож
     * зашите тут число виглядало б правильним доти, доки хтось не порівняє
     * його з package.json. Ворота стоять на ВІДСУТНОСТІ літерала, а не на
     * його значенні: збіг значень сьогодні нічого не каже про завтра. */
    const src = readFileSync(join(ROOT, "src", "server.ts"), "utf8");
    expect(src).toContain("version: PACKAGE_VERSION");
    expect(src).not.toMatch(/version:\s*"\d+\.\d+\.\d+"/u);
  });

  it("версія має вигляд semver", () => {
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  });
});
