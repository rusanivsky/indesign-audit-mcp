#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PACKAGE_VERSION } from "./version.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerStatusTool } from "./tools/status.js";
import { registerInspectTools } from "./tools/inspect.js";
import { registerFindTools } from "./tools/find.js";
import { registerCorrectionTools } from "./tools/corrections.js";
import { registerPdfTools } from "./tools/pdf.js";
import { registerRunTool } from "./tools/run.js";
import { registerTypographyTools } from "./tools/typography.js";
import { registerCompositionTools } from "./tools/composition.js";
import { registerMapTools } from "./tools/map.js";
import { registerPaginationTools } from "./tools/pagination.js";
import { registerStyleTools } from "./tools/styles.js";
import { registerPreflightTools } from "./tools/preflight.js";
import { registerBibliographyTools } from "./tools/bibliography.js";
import { registerSpellingTools } from "./tools/spelling.js";
import { registerGeometryTools } from "./tools/geometry.js";
import { registerColorTools } from "./tools/color.js";
import { registerRenderTools } from "./tools/render.js";

const server = new McpServer({ name: "indesign-audit-mcp", version: PACKAGE_VERSION });

registerStatusTool(server);
registerInspectTools(server);
registerFindTools(server);
registerCorrectionTools(server);
registerPdfTools(server);
registerRunTool(server);
registerTypographyTools(server);
registerCompositionTools(server);
registerMapTools(server);
registerStyleTools(server);
registerPaginationTools(server);
registerPreflightTools(server);
registerBibliographyTools(server);
registerSpellingTools(server);
registerGeometryTools(server);
registerColorTools(server);
registerRenderTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
