import { describe, expect, it } from "vitest";
import { jsxModules } from "../../src/bridge/runner.js";

/*
 * A4. Гейт фікстур покладається на те, що проєкт `integration` у vitest.config.ts
 * виставляє INDESIGN_MCP_FIXTURES. Якщо змінна не дійде, кожен інтеграційний тест
 * упаде на відсутньому обробнику `__fixture_make` — але лише тоді, коли InDesign
 * запущено. Ця перевірка ловить поломку конфігу негайно і без InDesign.
 */
describe("оточення інтеграційного проєкту", () => {
  it("INDESIGN_MCP_FIXTURES виставлено конфігом vitest", () => {
    expect(process.env.INDESIGN_MCP_FIXTURES).toBeTruthy();
  });

  it("фікстурні обробники доступні в цьому проєкті", () => {
    expect(jsxModules()).toContain("_fixtures.jsx");
  });
});
