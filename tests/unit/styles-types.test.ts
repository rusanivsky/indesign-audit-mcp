import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE_NAMES } from "../../src/styles/types.js";

describe("словник Фази 5", () => {
  it("називає обидва службові стилі, виміряні в книжці", () => {
    expect(DEFAULT_STYLE_NAMES).toContain("[Basic Paragraph]");
    expect(DEFAULT_STYLE_NAMES).toContain("[No Paragraph Style]");
  });

  it("не містить нічого понад ці два — щоб список не розповзався здогадами", () => {
    expect(DEFAULT_STYLE_NAMES).toHaveLength(2);
  });
});
