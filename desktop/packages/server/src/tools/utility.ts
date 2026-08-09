import type { AgentTool } from "./types";

/** 实用工具：时间感知 + JSON 处理 */
export const utilityTools: AgentTool[] = [
  {
    name: "get_datetime",
    description: "Get the current date and time (ISO 8601). Use for time-sensitive tasks.",
    parameters: { type: "object", properties: {} },
    async execute(): Promise<string> {
      return new Date().toISOString();
    },
  },
  {
    name: "json_tool",
    description: "Validate and pretty-format JSON. Returns formatted JSON or an error message.",
    parameters: {
      type: "object",
      properties: {
        json: { type: "string", description: "JSON string to validate/format" },
        indent: { type: "number", description: "indent spaces (default 2)" },
      },
      required: ["json"],
    },
    async execute(input: unknown): Promise<string> {
      const { json, indent } = (input ?? {}) as { json?: string; indent?: number };
      if (json === undefined) return "error: json required";
      try {
        const parsed = JSON.parse(json);
        return JSON.stringify(parsed, null, indent ?? 2);
      } catch (err) {
        return `invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
];
