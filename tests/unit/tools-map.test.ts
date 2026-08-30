import { describe, expect, it } from "vitest";
import { registerMapTools } from "../../src/tools/map.js";

interface Registered {
  name: string;
  config: { inputSchema: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function collect(): { tools: Registered[]; server: { registerTool: (...a: never[]) => void } } {
  const tools: Registered[] = [];
  const server = {
    registerTool: (name: string, config: Registered["config"], handler: Registered["handler"]) => {
      tools.push({ name, config, handler });
    },
  };
  registerMapTools(server as never);
  return { tools, server: server as never };
}

describe("реєстрація", () => {
  it("реєструє document_map", () => {
    expect(collect().tools.map((t) => t.name)).toContain("document_map");
  });

  it("headingStyles необов'язковий — без нього дерева немає", () => {
    const tool = collect().tools.find((t) => t.name === "document_map")!;
    expect(tool.config.inputSchema.headingStyles).toBeDefined();
    const parsed = (tool.config.inputSchema.headingStyles as { isOptional: () => boolean }).isOptional();
    expect(parsed).toBe(true);
  });

  it("pages необов'язковий — без нього весь документ", () => {
    const tool = collect().tools.find((t) => t.name === "document_map")!;
    expect((tool.config.inputSchema.pages as { isOptional: () => boolean }).isOptional()).toBe(true);
  });
});

describe("layout_audit", () => {
  it("зареєстрований", () => {
    expect(collect().tools.map((t) => t.name)).toContain("layout_audit");
  });

  it("families за замовчуванням — обидві родини", () => {
    const tool = collect().tools.find((t) => t.name === "layout_audit")!;
    const schema = tool.config.inputSchema.families as { parse: (v?: unknown) => string[] };
    expect(schema.parse(undefined)).toEqual(["overrides", "masters"]);
  });

  it("includeMasters за замовчуванням — false", () => {
    const tool = collect().tools.find((t) => t.name === "layout_audit")!;
    const schema = tool.config.inputSchema.includeMasters as { parse: (v?: unknown) => boolean };
    expect(schema.parse(undefined)).toBe(false);
  });

  it("detail необов'язковий — без нього поіменного переліку немає взагалі", () => {
    const tool = collect().tools.find((t) => t.name === "layout_audit")!;
    expect((tool.config.inputSchema.detail as { isOptional: () => boolean }).isOptional()).toBe(true);
  });
});
