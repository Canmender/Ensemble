import { z } from "zod";

export const providerTypeSchema = z.enum(["anthropic", "openai", "custom"]);

export const providerConfigSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/i),
  name: z.string().min(1),
  type: providerTypeSchema,
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  apiKeySet: z.boolean().optional(),
  models: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
  extraHeaders: z.record(z.string()).optional(),
  enabled: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ProviderConfigInput = z.input<typeof providerConfigSchema>;

export const appSettingsSchema = z.object({
  workspaceRoot: z.string().default(""),
  searchApi: z
    .object({
      provider: z.enum(["duckduckgo", "serper", "tavily"]),
      apiKey: z.string().optional(),
    })
    .optional(),
  codeExecutionConfirm: z.enum(["ask", "always", "never"]).default("ask"),
  defaultProviderId: z.string().optional(),
});

export type AppSettingsInput = z.input<typeof appSettingsSchema>;
