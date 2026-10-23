import { z } from 'zod';

/** What an agent is doing right now, derived from its transcript and the live session registry. */
export const ActivitySchema = z.enum([
  'thinking',
  'editing',
  'reading',
  'running',
  'browsing',
  'delegating',
  'planning',
  'waiting',
]);
export type Activity = z.infer<typeof ActivitySchema>;

export const AgentKindSchema = z.enum(['session', 'subagent']);
export type AgentKind = z.infer<typeof AgentKindSchema>;

export const StepResultSchema = z.enum(['running', 'ok', 'failed']);
export type StepResult = z.infer<typeof StepResultSchema>;

/** One tool call the agent made: what it was, when, and how it went. */
export const AgentStepSchema = z.object({
  activity: ActivitySchema,
  detail: z.string().nullable(),
  at: z.number(),
  result: StepResultSchema,
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

/** The story behind an agent's activity, for the person card. Text is clipped and masked. */
export const AgentInsightSchema = z.object({
  /** The latest request the agent was given (a helper's brief, for subagents). */
  prompt: z.string().nullable(),
  /** The last thing the agent said. */
  said: z.string().nullable(),
  /** Recent tool calls, newest first. */
  steps: z.array(AgentStepSchema),
  /** Files it edited recently, newest first. */
  files: z.array(z.string()),
  /** Counted over the part of the transcript that was read, not the whole session. */
  counts: z.object({ steps: z.number(), commands: z.number(), failures: z.number() }),
  branch: z.string().nullable(),
  model: z.string().nullable(),
});
export type AgentInsight = z.infer<typeof AgentInsightSchema>;

export const AgentSnapshotSchema = z.object({
  id: z.string(),
  kind: AgentKindSchema,
  parentId: z.string().nullable(),
  roomId: z.string(),
  /** Session title or the task a subagent was given. */
  label: z.string().nullable(),
  /** Subagent type (e.g. "Explore"), or null for a top-level session. */
  role: z.string().nullable(),
  activity: ActivitySchema,
  /** Short, safe hint about the activity: a file name, a command description, a host. */
  detail: z.string().nullable(),
  /** Epoch ms when the current activity started. */
  activitySince: z.number(),
  /** Epoch ms when the agent first showed up. */
  startedAt: z.number(),
  insight: AgentInsightSchema,
});
export type AgentSnapshot = z.infer<typeof AgentSnapshotSchema>;

export const RoomSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;

export const SourceNameSchema = z.enum(['live', 'demo']);
export type SourceName = z.infer<typeof SourceNameSchema>;

export const OfficeSnapshotSchema = z.object({
  source: SourceNameSchema,
  at: z.number(),
  rooms: z.array(RoomSnapshotSchema),
  agents: z.array(AgentSnapshotSchema),
});
export type OfficeSnapshot = z.infer<typeof OfficeSnapshotSchema>;

export const API_EVENTS_PATH = '/api/events';
export const SNAPSHOT_EVENT = 'snapshot';
