import { z } from 'zod';
import type { Activity } from '../../shared/protocol.ts';

const DETAIL_MAX = 48;

export interface ToolActivity {
  activity: Activity;
  detail: string | null;
}

const ToolInputSchema = z.looseObject({
  file_path: z.string().optional(),
  notebook_path: z.string().optional(),
  description: z.string().optional(),
  command: z.string().optional(),
  url: z.string().optional(),
  query: z.string().optional(),
  pattern: z.string().optional(),
  skill: z.string().optional(),
});

/** Long unbroken runs of letters and digits look like keys or tokens; never show those. */
const SECRET_LIKE = /[A-Za-z0-9_\-+/=]{24,}/g;

/** One line of text, secrets masked, cut to `max` characters. Everything shown goes through it. */
export function clip(text: string, max: number): string {
  const oneLine = text.replace(SECRET_LIKE, '•••').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function truncate(text: string): string {
  return clip(text, DETAIL_MAX);
}

function baseName(path: string | undefined): string | null {
  if (!path) return null;
  const parts = path.split('/').filter(Boolean);
  return parts.at(-1) ?? null;
}

function hostName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Only the program name of a shell command is shown: full commands can carry tokens or secrets
 * inline, while the model-written description is safe and reads better.
 */
function commandProgram(command: string | undefined): string | null {
  if (!command) return null;
  const words = command.trim().split(/\s+/);
  const program = words.find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  return program ? (baseName(program) ?? program) : null;
}

function prettyMcpServer(toolName: string): string {
  const server = toolName.split('__')[1] ?? toolName;
  return server.replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ');
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Artifact']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead']);
const RUN_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'Monitor', 'PowerShell']);
const PLAN_TOOLS = new Set([
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'EnterPlanMode',
  'Workflow',
]);
const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
const DELEGATE_TOOLS = new Set(['Agent', 'Task', 'SendMessage']);
const THINK_TOOLS = new Set(['ToolSearch', 'SubagentHandback']);

/** Bookkeeping tools that are not steps of the actual work. */
export function isBookkeeping(name: string): boolean {
  return THINK_TOOLS.has(name);
}

/** Maps a tool call to what a person in the office would look like they are doing. */
export function toolActivity(name: string, rawInput: unknown): ToolActivity {
  const parsed = ToolInputSchema.safeParse(rawInput);
  const input = parsed.success ? parsed.data : {};
  const detail = (value: string | null | undefined): string | null =>
    value ? truncate(value) : null;

  if (EDIT_TOOLS.has(name)) {
    return {
      activity: 'editing',
      detail: detail(baseName(input.file_path ?? input.notebook_path)),
    };
  }
  if (READ_TOOLS.has(name)) {
    return { activity: 'reading', detail: detail(baseName(input.file_path) ?? input.pattern) };
  }
  if (RUN_TOOLS.has(name)) {
    return {
      activity: 'running',
      detail: detail(input.description ?? commandProgram(input.command)),
    };
  }
  if (name === 'WebFetch') return { activity: 'browsing', detail: detail(hostName(input.url)) };
  if (name === 'WebSearch') return { activity: 'browsing', detail: detail(input.query) };
  if (DELEGATE_TOOLS.has(name))
    return { activity: 'delegating', detail: detail(input.description) };
  if (PLAN_TOOLS.has(name)) return { activity: 'planning', detail: null };
  if (ASK_TOOLS.has(name)) return { activity: 'waiting', detail: null };
  if (name === 'Skill') return { activity: 'reading', detail: detail(input.skill) };
  if (THINK_TOOLS.has(name)) return { activity: 'thinking', detail: null };
  if (name.startsWith('mcp__'))
    return { activity: 'browsing', detail: detail(prettyMcpServer(name)) };
  return { activity: 'running', detail: detail(name) };
}
