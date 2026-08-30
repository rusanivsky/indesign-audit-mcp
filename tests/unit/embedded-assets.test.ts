import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { planJsxLoads, jsxModules } from "../../src/bridge/runner.js";
import { loadTemplate, templatePath } from "../../src/cli/report/template.js";
import { clearAssetsForTest, embeddedAssetNames, readAsset, registerAsset } from "../../src/embedded/assets.js";

const ТЕКА = join(sep, "tmp", "idmcp-тест");

afterEach(() => {
  clearAssetsForTest();
});

describe("реєстр вшитих активів", () => {
  it("порожній без бандла — звичайна збірка читає з диска, як і читала", () => {
    expect(embeddedAssetNames()).toEqual([]);
    expect(readAsset("jsx/_core.jsx")).toBeNull();
    expect(readAsset("cli/template/report.html")).toBeNull();
  });

  it("віддає рівно те, що поклали", () => {
    registerAsset("jsx/_core.jsx", "var IDMCP = {};");
    expect(readAsset("jsx/_core.jsx")).toBe("var IDMCP = {};");
  });
});

describe("план завантаження JSX", () => {
  it("без вшивання веде на диск і НЕ просить нічого записувати", () => {
    const план = planJsxLoads(jsxModules({}), ТЕКА);
    for (const item of план) {
      expect(item.contents).toBeNull();
      expect(item.path.startsWith(ТЕКА)).toBe(false);
      expect(item.path).toContain(`${sep}jsx${sep}`);
    }
  });

  it("зі вшиванням веде в тимчасову теку й несе вміст із собою", () => {
    registerAsset("jsx/_core.jsx", "var IDMCP = {};");
    const план = planJsxLoads(["_core.jsx"], ТЕКА);
    expect(план).toEqual([{ path: join(ТЕКА, "_core.jsx"), contents: "var IDMCP = {};" }]);
  });

  /*
   * Порядок — єдина річ, яку вшивання могло б зіпсувати тихо: `_core.jsx`
   * оголошує `IDMCP`, а `inspect.jsx` мусить лягти до `cli-extras.jsx`,
   * інакше `IDMCP.cliPageOfPara` віддає «монтажний стіл» для кожного абзаца
   * і жоден вимір не падає — просто всі сторінки стають неправильними.
   */
  it("зберігає порядок модулів незмінним, чим би вони не бралися", () => {
    const модулі = jsxModules({});
    registerAsset("jsx/_core.jsx", "// core");
    registerAsset("jsx/cli-extras.jsx", "// extras");
    const план = planJsxLoads(модулі, ТЕКА);

    expect(план.length).toBe(модулі.length);
    for (let i = 0; i < модулі.length; i++) {
      expect(план[i]!.path.endsWith(модулі[i]!)).toBe(true);
    }
    const iCore = модулі.indexOf("_core.jsx");
    const iInspect = модулі.indexOf("inspect.jsx");
    const iExtras = модулі.indexOf("cli-extras.jsx");
    expect(iCore).toBe(0);
    expect(iInspect).toBeLessThan(iExtras);
  });

  it("змішаний стан: вшитий модуль їде з теки, невшитий — з диска", () => {
    registerAsset("jsx/_core.jsx", "// core");
    const план = planJsxLoads(["_core.jsx", "inspect.jsx"], ТЕКА);
    expect(план[0]!.contents).toBe("// core");
    expect(план[0]!.path).toBe(join(ТЕКА, "_core.jsx"));
    expect(план[1]!.contents).toBeNull();
    expect(план[1]!.path.startsWith(ТЕКА)).toBe(false);
  });
});

describe("шаблон звіту", () => {
  it("без вшивання читається з диска — сторожа cli-template.test.ts лишається чинною", () => {
    expect(loadTemplate()).toBe(readFileSync(templatePath(), "utf8"));
  });

  it("вшитий шаблон переважає диск: у бандлі теки dist/cli/template не існує", () => {
    registerAsset("cli/template/report.html", "<html>вшитий</html>");
    expect(loadTemplate()).toBe("<html>вшитий</html>");
  });
});
