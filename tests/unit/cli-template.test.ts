import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTemplate } from "../../src/cli/report/template.js";

const СКІЛ = join(homedir(), ".claude/skills/print-audit-report/assets/report-template.html");

function блок(html: string, тег: "script" | "style"): string {
  const m = html.match(new RegExp(`<${тег}[^>]*>([\\s\\S]*?)</${тег}>`, "g"));
  return (m ?? []).join("\n");
}

describe("привезений шаблон", () => {
  it("читається з репозиторію, а не з ~/.claude — на іншій машині скіла немає", () => {
    const t = loadTemplate();
    expect(t.length).toBeGreaterThan(1000);
    expect(t).toMatch(/id="tally"/);
  });

  it("несе розмітку трекера незмінною", () => {
    const t = loadTemplate();
    for (const id of ["fillDone", "fillKept", "nDone", "nKept", "hideKept", "undo", "reset"]) {
      expect(t).toMatch(new RegExp(`id="${id}"`));
    }
  });

  it.skipIf(!existsSync(СКІЛ))(
    "не розійшовся зі скілом — інакше звіт тихо застаріє",
    () => {
      const скіл = readFileSync(СКІЛ, "utf8");
      const наш = loadTemplate();
      expect(блок(наш, "script")).toBe(блок(скіл, "script"));
      expect(блок(наш, "style")).toBe(блок(скіл, "style"));
    },
  );
});

/*
 * Оператор побачив у звіті кнопку з написом «↶» замість «↶».
 *
 * Причина класу, а не випадку: `\uXXXX` — екранування JAVASCRIPT. У тілі
 * HTML воно нічого не означає, і браузер чесно малює вісім літер. Помилка
 * тиха: розмітка ціла, кнопка на місці, працює — просто підпис нечитний.
 * Так само тихо вона повернеться, щойно хтось знову напише escape там, де
 * потрібен сам символ.
 *
 * Тому заборона суцільна: у шаблоні не сміє лишитись ЖОДНОГО `\uXXXX`.
 * Перевірено, що в блоках <script> їх немає теж — тобто правило нічого
 * законного не ловить, і послаблювати його не доведеться.
 */
describe("у шаблоні немає невитлумачених екранувань", () => {
  it("жодного \\uXXXX — ані в розмітці, ані в скриптах", () => {
    const знайдені = [...loadTemplate().matchAll(/\\u[0-9a-fA-F]{4}/g)].map((m) => m[0]);
    expect(знайдені, `у HTML це вісім літер, а не символ: ${знайдені.join(", ")}`).toEqual([]);
  });

  it("кнопка скасування несе САМ символ, а не його запис", () => {
    const t = loadTemplate();
    expect(t).toMatch(/id="undo"[^>]*>↶</);
  });

  /* Кодування мусить бути ОГОЛОШЕНЕ: без цього браузер для file:// вгадує
   * Latin-1, і весь український текст звіту стає мозаїкою. Числа й верстка
   * при цьому цілі — тобто відмова тиха. */
  it("оголошує utf-8, інакше звіт нечитний з диска", () => {
    expect(loadTemplate()).toMatch(/<meta\s+charset=["']utf-8["']/i);
  });
});
