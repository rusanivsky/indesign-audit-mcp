import { describe, expect, it } from "vitest";
import { hasCyrillic, HN, LATIN_LOWER, LATIN_UPPER } from "../../src/bibliography/latin.js";

describe("latin", () => {
  it("класи латиниці не містять кирилиці", () => {
    expect(new RegExp(`^[${LATIN_UPPER}]+$`, "u").test("ABZ")).toBe(true);
    expect(new RegExp(`^[${LATIN_UPPER}]+$`, "u").test("АБВ")).toBe(false);
    expect(new RegExp(`^[${LATIN_LOWER}]+$`, "u").test("abz")).toBe(true);
    expect(new RegExp(`^[${LATIN_LOWER}]+$`, "u").test("абв")).toBe(false);
  });

  it("HN пропускає примусовий розрив, але НЕ абзац", () => {
    /*
     * Пастка, оплачена 27.08: `\r` — межа абзацу, `\n` — розрив УСЕРЕДИНІ
     * абзацу. Набірник ламає запис руками, і розрив стає між приписною
     * двокрапкою й наступною зоною. Клас, що не пускає `\n`, на живому
     * документі просто не спрацює; клас, що пускає `\r`, зшиє два абзаци.
     */
    const re = new RegExp(`^a${HN}+b$`, "u");
    expect(re.test("a b")).toBe(true);
    expect(re.test("a\nb")).toBe(true);
    expect(re.test("a\rb")).toBe(false);
  });

  it("hasCyrillic бачить одну літеру серед латиниці", () => {
    expect(hasCyrillic("Kyiv")).toBe(false);
    expect(hasCyrillic("Київ")).toBe(true);
    expect(hasCyrillic("ISBN 978, Київ, 2026")).toBe(true);
    expect(hasCyrillic("")).toBe(false);
  });

  it("hasCyrillic бачить і ті блоки, що поза U+0400–U+04FF", () => {
    /*
     * Українська обходиться основним блоком, але «кирилиця» ним не
     * вичерпується. Ворота, що дивляться лише в основний блок, читаються як
     * «кирилиці немає», хоча вона є — рівно той клас мовчазного промаху, що
     * його ловить решта цього файла.
     */
    expect(hasCyrillic("Ԁ")).toBe(true); // Cyrillic Supplement
    expect(hasCyrillic("Ꙁ")).toBe(true); // Cyrillic Extended-B
  });
});
