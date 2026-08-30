import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { numberingPath, readNextNumber, saveNextNumber } from "../../src/corrections/numbering.js";

let dir: string;
const prev = process.env.INDESIGN_MCP_HOME;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "numbering-"));
  process.env.INDESIGN_MCP_HOME = dir;
});

afterEach(async () => {
  if (prev === undefined) delete process.env.INDESIGN_MCP_HOME;
  else process.env.INDESIGN_MCP_HOME = prev;
  await rm(dir, { recursive: true, force: true });
});

describe("наскрізна нумерація", () => {
  it("для незнайомого документа починає з 1", async () => {
    expect(await readNextNumber("Книга.indd")).toBe(1);
  });

  it("зберігає й повертає номер — переживає перезапуск сервера", async () => {
    await saveNextNumber("Книга.indd", 235);
    expect(await readNextNumber("Книга.indd")).toBe(235);
  });

  it("нумерація окрема на кожен документ", async () => {
    await saveNextNumber("Книга.indd", 235);
    await saveNextNumber("Інша.indd", 7);
    expect(await readNextNumber("Книга.indd")).toBe(235);
    expect(await readNextNumber("Інша.indd")).toBe(7);
  });

  it("небезпечна назва документа не виводить шлях за межі теки", async () => {
    const p = numberingPath("../../evil.indd");
    expect(p.startsWith(dir)).toBe(true);
    expect(p).not.toContain("..");
  });

  it("кирилиця в назві не ламає шлях", async () => {
    await saveNextNumber("Book-A 260728-1200.indd", 42);
    expect(await readNextNumber("Book-A 260728-1200.indd")).toBe(42);
  });

  it("пошкоджений файл лічильника не валить виклик — починаємо з 1", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const p = numberingPath("Книга.indd");
    await mkdir(join(dir, "numbering"), { recursive: true });
    await writeFile(p, "{ це не JSON", "utf8");
    expect(await readNextNumber("Книга.indd")).toBe(1);
  });
});
