import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isProgramEntry } from "../../src/cli/audit.js";

const МОДУЛЬ = pathToFileURL("/repo/dist/cli/audit.js").href;
const ФАЙЛ = fileURLToPath(МОДУЛЬ);

/** Симлінк `bin/indesign-audit` розв'язується у справжню точку входу. */
const розвʼязати = (p: string): string =>
  p === "/repo/node_modules/.bin/indesign-audit" ? ФАЙЛ : p;

describe("вартовий точки входу", () => {
  it("запускає, коли argv[1] — це сам модуль", () => {
    expect(isProgramEntry(ФАЙЛ, МОДУЛЬ, розвʼязати)).toBe(true);
  });

  it("запускає через bin-симлінк — realpath зводить обидва в один файл", () => {
    expect(isProgramEntry("/repo/node_modules/.bin/indesign-audit", МОДУЛЬ, розвʼязати)).toBe(true);
  });

  /*
   * Той самий випадок, який стара умова `endsWith("audit.js")` пропускала
   * мовчки: бандл зветься інакше, аудит не виконувався, код виходу був 0.
   */
  it("запускає бандл, хоч він і зветься не audit.js", () => {
    const бандл = pathToFileURL("/куди/переносимо/indesign-audit.mjs").href;
    expect(isProgramEntry(fileURLToPath(бандл), бандл, розвʼязати)).toBe(true);
  });

  it("НЕ запускає при імпорті з тесту: argv[1] — бінарник vitest", () => {
    expect(isProgramEntry("/repo/node_modules/.bin/vitest", МОДУЛЬ, розвʼязати)).toBe(false);
  });

  it("НЕ запускає, коли argv[1] відсутній", () => {
    expect(isProgramEntry(undefined, МОДУЛЬ, розвʼязати)).toBe(false);
  });

  it("НЕ запускає, коли точки входу немає на диску — мовчазний нуль дорожчий за незапуск", () => {
    const кидає = (): string => {
      throw new Error("ENOENT");
    };
    expect(isProgramEntry(ФАЙЛ, МОДУЛЬ, кидає)).toBe(false);
  });
});
