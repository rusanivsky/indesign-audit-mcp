import { describe, expect, it } from "vitest";
import { readPngSize } from "../../src/render/png-size.js";

/*
 * Мінімальний, але СПРАВЖНІЙ заголовок PNG: сигнатура + чанк IHDR
 * (довжина 13, тип "IHDR", ширина/висота big-endian uint32, п'ять байтів
 * решти полів IHDR, довільні 4 байти CRC — функція його не перевіряє,
 * бо їй потрібні лише ширина й висота). 991 × 1398 — саме те число, яке
 * спек §4 зафіксував як ЗМІРЯНИЙ результат `exportResolution = 148` на
 * сторінці 170 × 240 мм (а не заплановані 1400).
 */
function makePngHeader(widthPx: number, heightPx: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // довжина чанку IHDR
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(widthPx, 16);
  buf.writeUInt32BE(heightPx, 20);
  buf[24] = 8; // bit depth
  buf[25] = 2; // color type (RGB)
  buf[26] = 0; // compression
  buf[27] = 0; // filter
  buf[28] = 0; // interlace
  buf.writeUInt32BE(0, 29); // CRC — не перевіряється
  return buf;
}

describe("readPngSize", () => {
  it("читає ширину й висоту зі справжнього заголовка PNG (991×1398, спек §4)", () => {
    const buf = makePngHeader(991, 1398);
    expect(readPngSize(buf)).toEqual({ widthPx: 991, heightPx: 1398 });
  });

  it("читає інші розміри без плутанини ширини й висоти", () => {
    const buf = makePngHeader(1400, 989);
    expect(readPngSize(buf)).toEqual({ widthPx: 1400, heightPx: 989 });
  });

  it("кидає на буфері без сигнатури PNG", () => {
    const notPng = Buffer.from("це не PNG, а звичайний текстовий буфер", "utf8");
    expect(() => readPngSize(notPng)).toThrow(/PNG/);
  });

  it("кидає на порожньому буфері замість читання за межами", () => {
    expect(() => readPngSize(Buffer.alloc(0))).toThrow(/PNG/);
  });

  it("кидає на буфері з правильною сигнатурою, але надто коротким для IHDR", () => {
    const short = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(() => readPngSize(short)).toThrow(/PNG/);
  });
});
