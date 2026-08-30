/*
 * Actual PNG pixels — read from the IHDR chunk, not computed.
 *
 * Spec §4: `exportResolution = 148` produced EXACTLY 991 × 1398, not the
 * planned 1400 (InDesign rounds down). So the response returns the ACTUAL
 * pixel dimensions of the finished file, not what a formula would have
 * predicted from them.
 *
 * PNG format: the first 8 bytes are the signature (89 50 4E 47 0D 0A 1A
 * 0A), immediately followed by the IHDR chunk: 4 bytes of length (always
 * 13), 4 bytes of type ("IHDR"), then width and height — 4 bytes each,
 * big-endian uint32, with no offset from the chunk type. This is ALWAYS
 * the first chunk, by the PNG specification.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

export interface PngSize {
  widthPx: number;
  heightPx: number;
}

function isPng(buf: Buffer): boolean {
  if (buf.length < IHDR_HEIGHT_OFFSET + 4) {
    return false;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

/** Reads width/height from IHDR. Throws if the PNG signature doesn't match. */
export function readPngSize(buf: Buffer): PngSize {
  if (!isPng(buf)) {
    throw new Error("Not a PNG: the file signature does not match the expected one");
  }
  return {
    widthPx: buf.readUInt32BE(IHDR_WIDTH_OFFSET),
    heightPx: buf.readUInt32BE(IHDR_HEIGHT_OFFSET),
  };
}
