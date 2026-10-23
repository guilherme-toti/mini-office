import { z } from 'zod';
import type { Activity } from '../../shared/protocol.ts';
import { toolActivity, type ToolActivity } from './activity.ts';

const ContentBlockSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
});

const RecordSchema = z.looseObject({
  type: z.string(),
  timestamp: z.string().optional(),
  subtype: z.string().optional(),
  cwd: z.string().optional(),
  aiTitle: z.string().optional(),
  isMeta: z.boolean().optional(),
  message: z
    .looseObject({
      stop_reason: z.string().nullable().optional(),
      content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
    })
    .optional(),
});
type TranscriptRecord = z.infer<typeof RecordSchema>;

interface PendingTool extends ToolActivity {
  id: string;
  name: string;
}

/** What the tail of one transcript says about its agent. Updated record by record. */
export interface TranscriptState {
  title: string | null;
  cwd: string | null;
  pending: PendingTool[];
  phase: 'idle' | 'thinking' | 'tool' | 'turn-ended' | 'finished';
  lastEventAt: number;
}

export function emptyTranscriptState(): TranscriptState {
  return { title: null, cwd: null, pending: [], phase: 'idle', lastEventAt: 0 };
}

const HANDBACK_TOOL = 'SubagentHandback';

function recordTime(record: TranscriptRecord, fallback: number): number {
  const parsed = record.timestamp ? Date.parse(record.timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyAssistant(state: TranscriptState, record: TranscriptRecord): TranscriptState {
  const content = record.message?.content;
  const blocks = Array.isArray(content) ? content : [];
  let pending = state.pending;
  let phase: TranscriptState['phase'] = 'thinking';
  for (const block of blocks) {
    const { id } = block;
    if (block.type !== 'tool_use' || !block.name || !id) continue;
    if (block.name === HANDBACK_TOOL) phase = 'finished';
    if (pending.some((tool) => tool.id === id)) continue;
    pending = [...pending, { id, name: block.name, ...toolActivity(block.name, block.input) }];
  }
  if (phase !== 'finished') {
    if (pending.length > 0) phase = 'tool';
    else if (record.message?.stop_reason === 'end_turn') phase = 'turn-ended';
  }
  return { ...state, pending, phase };
}

function applyUser(state: TranscriptState, record: TranscriptRecord): TranscriptState {
  const content = record.message?.content;
  if (typeof content === 'string') {
    // A meta message is injected context, not someone giving the agent new work.
    return record.isMeta ? state : { ...state, pending: [], phase: 'thinking' };
  }
  const blocks = content ?? [];
  const resolved = new Set(
    blocks.flatMap((block) =>
      block.type === 'tool_result' && block.tool_use_id ? [block.tool_use_id] : [],
    ),
  );
  if (resolved.size === 0) {
    const hasText = blocks.some((block) => block.type === 'text');
    return hasText && !record.isMeta ? { ...state, pending: [], phase: 'thinking' } : state;
  }
  const pending = state.pending.filter((tool) => !resolved.has(tool.id));
  if (state.phase === 'finished') return { ...state, pending };
  return { ...state, pending, phase: pending.length > 0 ? 'tool' : 'thinking' };
}

/** Folds one JSONL line into the state; unknown or malformed lines are ignored. */
export function applyTranscriptLine(
  state: TranscriptState,
  line: string,
  now: number,
): TranscriptState {
  if (!line.trim()) return state;
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return state;
  }
  const parsed = RecordSchema.safeParse(json);
  if (!parsed.success) return state;
  const record = parsed.data;
  if (record.cwd && record.cwd !== state.cwd) state = { ...state, cwd: record.cwd };

  switch (record.type) {
    case 'ai-title':
      return record.aiTitle ? { ...state, title: record.aiTitle } : state;
    case 'assistant':
      return { ...applyAssistant(state, record), lastEventAt: recordTime(record, now) };
    case 'user':
      return { ...applyUser(state, record), lastEventAt: recordTime(record, now) };
    case 'system':
      if (record.subtype === 'turn_duration' && state.phase !== 'finished') {
        return { ...state, pending: [], phase: 'turn-ended', lastEventAt: recordTime(record, now) };
      }
      return state;
    default:
      return state;
  }
}

/** The single activity the office shows for this transcript. */
export function transcriptActivity(state: TranscriptState): ToolActivity {
  const latest = state.pending.at(-1);
  if (state.phase === 'tool' && latest) {
    return { activity: latest.activity, detail: latest.detail };
  }
  const byPhase: Record<TranscriptState['phase'], Activity> = {
    idle: 'waiting',
    thinking: 'thinking',
    tool: 'thinking',
    'turn-ended': 'waiting',
    finished: 'waiting',
  };
  return { activity: byPhase[state.phase], detail: null };
}
