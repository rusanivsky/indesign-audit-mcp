import { readFileSync } from "node:fs";

/**
 * ВЕРСІЯ МУСИТЬ БУТИ ОДНА, І ЖИТИ ВОНА МАЄ В `package.json`.
 *
 * До 2026-08-27 рядок `"0.1.0"` стояв ДРУГИЙ раз — у `new McpServer({...})`.
 * Клієнт MCP показує саме його (він їде в `serverInfo` під час рукостискання),
 * тож розбіжність із `package.json` не помітив би ніхто: обидва числа
 * виглядають правильними, поки не порівняти їх поруч. Класика та сама, що з
 * назвами кроків UNDO по два боки моста — типечек такого не бачить.
 *
 * Шлях рахується ВІД ЦЬОГО ФАЙЛА, а не від того, хто його імпортує: `src/`
 * і `dist/` лежать на одну теку вглиб, тож `../package.json` слушний в обох,
 * і лишається слушним для `dist/cli/audit.js`, який на рівень глибший —
 * бо читання відбувається тут, а не там. У встановленому пакеті
 * (`node_modules/indesign-audit-mcp/dist/version.js`) — так само: npm завжди
 * кладе `package.json` у тарбол, незалежно від поля `files`.
 */
function readVersion(): string {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    throw new Error("package.json не має поля version");
  }
  const { version } = parsed as { version: unknown };
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`package.json: version має бути непорожнім рядком, а не ${typeof version}`);
  }
  return version;
}

export const PACKAGE_VERSION = readVersion();
