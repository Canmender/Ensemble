import { z } from "zod";

export const singleTaskSchema = z.object({
  mode: z.literal("single"),
  prompt: z.string().min(1),
  agentIds: z.array(z.string()).min(1),
  aggregate: z.boolean().optional(),
  aggregatorAgentId: z.string().optional(),
});

export const workflowTaskSchema = z.object({
  mode: z.literal("workflow"),
  workflowId: z.string().min(1),
  prompt: z.string().min(1),
});

export const chatTaskSchema = z.object({
  mode: z.literal("chat"),
  prompt: z.string().min(1),
  participantIds: z.array(z.string()).min(2),
  maxRounds: z.number().int().positive().default(3),
});

export const taskInputSchema = z.discriminatedUnion("mode", [
  singleTaskSchema,
  workflowTaskSchema,
  chatTaskSchema,
]);

export const createTaskSchema = z.object({
  title: z.string().min(1),
  input: taskInputSchema,
});

export const workflowNodeSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  prompt: z.string().min(1),
});

export const edgeConditionSchema = z.union([
  z.literal("on_success"),
  z.literal("on_failure"),
  z.object({ type: z.literal("if_output_matches"), regex: z.string() }),
]);

export const workflowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  when: edgeConditionSchema,
});

export const workflowDefSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/i),
  name: z.string().min(1),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema),
});

export type WorkflowDefInput = z.input<typeof workflowDefSchema>;
