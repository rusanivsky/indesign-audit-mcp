import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

function stateDir(): string {
  return process.env.INDESIGN_MCP_HOME ?? join(homedir(), ".indesign-mcp");
}

/**
 * The document name comes from InDesign and can contain anything — spaces,
 * Cyrillic, dots, in theory even path separators. What goes into the path is
 * not the name itself but its hash: that way no name can steer the record
 * outside the folder. Readability isn't needed here — the file is internal.
 */
export function numberingPath(docName: string): string {
  const hash = createHash("sha256").update(docName, "utf8").digest("hex").slice(0, 32);
  return join(stateDir(), "numbering", `${hash}.json`);
}

/**
 * Running correction numbering persists across calls and across server
 * restarts: the user refers to "#234" in later comments, and that number
 * has to mean the same thing next week. Numbering is separate per document.
 */
export async function readNextNumber(docName: string): Promise<number> {
  try {
    const raw = await readFile(numberingPath(docName), "utf8");
    const parsed = JSON.parse(raw) as { next?: unknown };
    /* A corrupted or foreign file must not crash applying corrections:
     * lost numbering is a nuisance, a broken run is a disaster. */
    return typeof parsed.next === "number" && Number.isInteger(parsed.next) && parsed.next > 0
      ? parsed.next
      : 1;
  } catch {
    return 1;
  }
}

export async function saveNextNumber(docName: string, next: number): Promise<void> {
  const path = numberingPath(docName);
  await mkdir(join(stateDir(), "numbering"), { recursive: true });
  await writeFile(path, JSON.stringify({ docName, next }, null, 2), "utf8");
}
