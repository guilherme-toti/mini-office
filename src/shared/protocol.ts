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
