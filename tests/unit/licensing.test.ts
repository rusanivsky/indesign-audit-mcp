import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/*
 * ВИНЯТОК З MIT МУСИТЬ БУТИ ПЕРЕВІРЯНИЙ, А НЕ ЗАПАМ'ЯТОВАНИЙ.
 *
 * `tests/fixtures/hunspell-oracle.json` — похідне від словників, які InDesign
 * возить із собою, і воно НЕ під MIT: uk_UA потрійно ліцензований, en_US під
 * дозволом Аткінсона, en_GB — копілефт. Увесь захист тут тримається на двох
 * речах, і обидві легко зникають мовчки: сусідній файл ліцензії (щоб той, хто
 * скопіює саму фікстуру, забрав умови з собою) і поле `files` у package.json
 * (щоб фікстура не поїхала в npm-тарбол разом із «пакет під MIT»).
 *
 * Прибрати нотатку — робота на одну секунду, і жоден інший тест цього не
 * помітить. Тому помічає цей.
 */
describe("виняток з MIT для словникової фікстури лишається названим", () => {
  const FIXTURE = join("tests", "fixtures", "hunspell-oracle.json");
  const NOTICE = join("tests", "fixtures", "hunspell-oracle.LICENSE.md");

  it("фікстура на місці, і коло неї лежить її власна ліцензія", () => {
    expect(existsSync(join(ROOT, FIXTURE))).toBe(true);
    expect(existsSync(join(ROOT, NOTICE))).toBe(true);
  });

  it("нотатка називає ВСІ ТРИ мовні блоки, а не ту, про яку згадали", () => {
    /* Блок, доданий у фікстуру без рядка в нотатці, — саме той випадок, коли
     * файл виглядає задокументованим, а насправді ні. */
    const oracle = JSON.parse(read(FIXTURE)) as Record<string, unknown>;
    const notice = read(NOTICE);
    expect(Object.keys(oracle).length).toBeGreaterThan(0);
    for (const lang of Object.keys(oracle)) {
      expect(notice, `у нотатці немає блоку ${lang}`).toContain(lang);
    }
  });

  it("нотатка каже прямо, що це не MIT", () => {
    expect(read(NOTICE)).toMatch(/not MIT/u);
  });

  it("повні тексти трьох ліцензій лежать у репозиторії", () => {
    /* Копілефт вимагає, щоб текст ліцензії їхав разом із твором. Самі тексти
     * дозволяють дослівне копіювання — це написано в них. */
    expect(read("licenses", "GPL-2.0.txt")).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(read("licenses", "LGPL-2.1.txt")).toContain("GNU LESSER GENERAL PUBLIC LICENSE");
    expect(read("licenses", "MPL-1.1.txt")).toContain("MOZILLA PUBLIC LICENSE");
  });

  it("npm-тарбол не може забрати фікстуру: `files` не сягає tests/", () => {
    /* Поле `license` в package.json описує ПАКЕТ, і для пакета «MIT» — правда
     * рівно доти, доки в нього не потрапить фікстура. Перевіряємо не текст
     * `files`, а те, чи бодай один його запис здатен її накрити. */
    const pkg = JSON.parse(read("package.json")) as { files?: string[]; license?: string };
    expect(pkg.license).toBe("MIT");
    expect(Array.isArray(pkg.files), "package.json без `files` возить усе дерево").toBe(true);
    for (const entry of pkg.files ?? []) {
      const root = entry.replace(/^!?\.?\//u, "").split("/")[0];
      expect(root, `запис files "${entry}" здатен накрити ${FIXTURE}`).not.toBe("tests");
      expect(root).not.toBe("");
      expect(root).not.toBe("*");
    }
  });

  it("THIRD-PARTY-NOTICES називає фікстуру поіменно", () => {
    expect(read("THIRD-PARTY-NOTICES.md")).toContain("hunspell-oracle.json");
  });
});
