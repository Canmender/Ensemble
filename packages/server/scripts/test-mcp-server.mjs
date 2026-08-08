// 测试用 MCP stdio server：提供 echo 工具，用于验证 MCP 接入
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "ensemble-test-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "回显输入文本",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    {
      name: "add",
      description: "两个数字相加",
      inputSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = req.params.arguments ?? {};
  if (req.params.name === "echo") {
    return { content: [{ type: "text", text: `ECHO: ${String(args.text ?? "")}` }] };
  }
  if (req.params.name === "add") {
    const sum = Number(args.a ?? 0) + Number(args.b ?? 0);
    return { content: [{ type: "text", text: `SUM: ${sum}` }] };
  }
  return { content: [{ type: "text", text: `unknown tool: ${req.params.name}` }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.on("SIGTERM", () => process.exit(0));
