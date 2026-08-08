import { z } from "zod";

export const agentKindSchema = z.literal("builtin");

export const agentCapabilitiesSchema = z.object({
  sessionResume: z.boolean(),
  partialStreaming: z.boolean(),
  toolUseEvents: z.boolean(),
  concurrent: z.boolean(),
  cwdConfigurable: z.boolean(),
  notes: z.array(z.string()).optional(),
});

export const agentConfigSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/i),
  name: z.string().min(1),
  kind: agentKindSchema,
  description: z.string().optional(),
  providerId: z.string().default(""),
  model: z.string().default(""),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  maxIterations: z.number().int().min(1).max(50).default(10),
  tools: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  memory: z
    .object({
      enabled: z.boolean().optional(),
      model: z.string().optional(),
      flushMinIntervalMs: z.number().min(0).optional(),
      flushMinNewTokens: z.number().min(0).optional(),
      consolidateMinIntervalMs: z.number().positive().optional(),
      injectMaxChars: z.number().positive().optional(),
    })
    .optional(),
  context: z
    .object({
      budgetTokens: z.number().positive().optional(),
      compactionThreshold: z.number().min(0).max(1).optional(),
      keepRecentRawGroups: z.number().int().positive().optional(),
      toolResultOffloadChars: z.number().positive().optional(),
    })
    .optional(),
  capabilities: agentCapabilitiesSchema,
  enabled: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type AgentConfigInput = z.input<typeof agentConfigSchema>;
