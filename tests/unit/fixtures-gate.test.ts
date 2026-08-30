import { describe, expect, it } from "vitest";
import { jsxModules } from "../../src/bridge/runner.js";

describe("гейт фікстурних обробників", () => {
  it("без INDESIGN_MCP_FIXTURES не завантажує _fixtures.jsx", () => {
    expect(jsxModules({})).not.toContain("_fixtures.jsx");
  });

  it("із INDESIGN_MCP_FIXTURES=1 завантажує _fixtures.jsx", () => {
    expect(jsxModules({ INDESIGN_MCP_FIXTURES: "1" })).toContain("_fixtures.jsx");
  });

  it("продакшн-набір містить усі робочі модулі", () => {
    const mods = jsxModules({});
    for (const m of ["_core.jsx", "inspect.jsx", "find.jsx", "apply.jsx", "run.jsx"]) {
      expect(mods).toContain(m);
    }
  });
});
