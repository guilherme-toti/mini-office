import { z } from 'zod';
import type { Activity, AgentInsight, AgentStep } from '../../shared/protocol.ts';
import { clip, isBookkeeping, toolActivity, type ToolActivity } from './activity.ts';

const ContentBlockSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  text: z.string().optional(),
  tool_use_id: z.string().optional(),
  is_error: z.boolean().nullable().optional(),
});
type ContentBlock = z.infer<typeof ContentBlockSchema>;

const RecordSchema = z.looseObject({
  type: z.string(),
  timestamp: z.string().optional(),
  subtype: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  aiTitle: z.string().optional(),
  isMeta: z.boolean().optional(),
  message: z
    .looseObject({
      model: z.string().optional(),
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

interface Step extends AgentStep {
  id: string;
}

/** What the tail of one transcript says about its agent. Updated record by record. */
export interface TranscriptState {
  title: string | null;
  cwd: string | null;
  pending: PendingTool[];
  phase: 'idle' | 'thinking' | 'tool' | 'turn-ended' | 'finished';
  lastEventAt: number;
  prompt: string | null;
  said: string | null;
  /** Oldest first, capped. */
  steps: Step[];
  /** Newest first, capped. */
  files: string[];
  counts: AgentInsight['counts'];
  branch: string | null;
  model: string | null;
}

const PROMPT_MAX = 280;
const SAID_MAX = 280;
const STEPS_KEPT = 8;
const FILES_KEPT = 6;

export function emptyTranscriptState(): TranscriptState {
  return {
    title: null,
    cwd: null,
    pending: [],
    phase: 'idle',
    lastEventAt: 0,
    prompt: null,
    said: null,
    steps: [],
    files: [],
    counts: { steps: 0, commands: 0, failures: 0 },
    branch: null,
    model: null,
  };
}

const HANDBACK_TOOL = 'SubagentHandback';

function recordTime(record: TranscriptRecord, fallback: number): number {
  const parsed = record.timestamp ? Date.parse(record.timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The words someone typed, if this message has any. Injected context arrives wrapped in tags
 * (`<command-name>`, `<local-command-stdout>`, reminders) and pasted images as placeholders.
 */
function typedText(content: string | ContentBlock[] | undefined): string | null {
  const raw =
    typeof content === 'string'
      ? content
      : (content ?? [])
          .flatMap((block) => (block.type === 'text' && block.text ? [block.text] : []))
          .join('\n');
  const text = raw
    .replace(/<([a-z-]+)>[\s\S]*?<\/\1>/g, '')
    .replace(/^\[Image[^\]]*\]$/gm, '')
    .trim();
  if (!text || text.startsWith('<')) return null;
  return clip(text, PROMPT_MAX);
}

function applyAssistant(
  state: TranscriptState,
  record: TranscriptRecord,
  at: number,
): TranscriptState {
  const content = record.message?.content;
  const blocks = Array.isArray(content) ? content : [];
  let { pending, steps, files, counts, said } = state;
  let phase: TranscriptState['phase'] = 'thinking';
  for (const block of blocks) {
    if (block.type === 'text' && block.text?.trim()) said = clip(block.text, SAID_MAX);
    const { id, name } = block;
    if (block.type !== 'tool_use' || !name || !id) continue;
    if (name === HANDBACK_TOOL) phase = 'finished';
    if (pending.some((tool) => tool.id === id)) continue;
    const activity = toolActivity(name, block.input);
    pending = [...pending, { id, name, ...activity }];
    if (isBookkeeping(name)) continue;
    steps = [...steps, { id, ...activity, at, result: 'running' as const }].slice(-STEPS_KEPT);
    counts = {
      ...counts,
      steps: counts.steps + 1,
      commands: counts.commands + (activity.activity === 'running' ? 1 : 0),
    };
    if (activity.activity === 'editing' && activity.detail) {
      files = [activity.detail, ...files.filter((file) => file !== activity.detail)].slice(
        0,
        FILES_KEPT,
      );
    }
  }
  if (phase !== 'finished') {
    if (pending.length > 0) phase = 'tool';
    else if (record.message?.stop_reason === 'end_turn') phase = 'turn-ended';
  }
  return {
    ...state,
    pending,
    phase,
    steps,
    files,
    counts,
    said,
    model: record.message?.model ?? state.model,
  };
}

function applyUser(state: TranscriptState, record: TranscriptRecord): TranscriptState {
  const content = record.message?.content;
  const blocks = typeof content === 'string' ? [] : (content ?? []);
  const results = blocks.filter((block) => block.type === 'tool_result' && block.tool_use_id);
  if (results.length === 0) {
    // A meta message is injected context, not someone giving the agent new work.
    if (record.isMeta) return state;
    const prompt = typedText(content);
    if (prompt === null && typeof content !== 'string') return state;
    return { ...state, pending: [], phase: 'thinking', prompt: prompt ?? state.prompt };
  }
  const outcome = new Map(results.map((block) => [block.tool_use_id, block.is_error === true]));
  const pending = state.pending.filter((tool) => !outcome.has(tool.id));
  const failed = [...outcome.values()].filter(Boolean).length;
  const steps = state.steps.map((step) => {
    const result = outcome.get(step.id);
    if (result === undefined) return step;
    return { ...step, result: result ? ('failed' as const) : ('ok' as const) };
  });
  const counts = { ...state.counts, failures: state.counts.failures + failed };
  if (state.phase === 'finished') return { ...state, pending, steps, counts };
  return { ...state, pending, steps, counts, phase: pending.length > 0 ? 'tool' : 'thinking' };
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
  if (record.gitBranch && record.gitBranch !== state.branch) {
    state = { ...state, branch: record.gitBranch };
  }

  switch (record.type) {
    case 'ai-title':
      return record.aiTitle ? { ...state, title: record.aiTitle } : state;
    case 'assistant': {
      const at = recordTime(record, now);
      return { ...applyAssistant(state, record, at), lastEventAt: at };
    }
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

/** The card's story for this transcript. */
export function transcriptInsight(state: TranscriptState): AgentInsight {
  return {
    prompt: state.prompt,
    said: state.said,
    steps: [...state.steps]
      .reverse()
      .map(({ activity, detail, at, result }) => ({ activity, detail, at, result })),
    files: state.files,
    counts: state.counts,
    branch: state.branch,
    model: state.model,
  };
}

export function emptyInsight(): AgentInsight {
  return transcriptInsight(emptyTranscriptState());
}
