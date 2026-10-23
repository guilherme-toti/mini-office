import { describe, expect, it } from 'vitest';
import { toolActivity } from './activity.ts';
import { buildRooms, projectRoot, transcriptFolderName } from './rooms.ts';
import {
  applyTranscriptLine,
  emptyTranscriptState,
  transcriptActivity,
  type TranscriptState,
} from './transcript.ts';

const NOW = 1_800_000_000_000;

function feed(lines: unknown[]): TranscriptState {
  return lines.reduce<TranscriptState>(
    (state, line) => applyTranscriptLine(state, JSON.stringify(line), NOW),
    emptyTranscriptState(),
  );
}

const prompt = (text: string) => ({
  type: 'user',
  timestamp: '2026-10-23T10:00:00.000Z',
  message: { role: 'user', content: text },
});
const toolUse = (id: string, name: string, input: unknown) => ({
  type: 'assistant',
  timestamp: '2026-10-23T10:00:01.000Z',
  message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] },
});
const toolResult = (id: string) => ({
  type: 'user',
  timestamp: '2026-10-23T10:00:02.000Z',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});

describe('transcript reducer', () => {
  it('is thinking right after a prompt', () => {
    expect(transcriptActivity(feed([prompt('fix the bug')])).activity).toBe('thinking');
  });

  it('shows the pending tool until its result arrives', () => {
    const editing = feed([prompt('go'), toolUse('t1', 'Edit', { file_path: '/repo/src/app.ts' })]);
    expect(transcriptActivity(editing)).toEqual({ activity: 'editing', detail: 'app.ts' });
    const after = feed([
      prompt('go'),
      toolUse('t1', 'Edit', { file_path: '/repo/src/app.ts' }),
      toolResult('t1'),
    ]);
    expect(transcriptActivity(after).activity).toBe('thinking');
  });

  it('ends the turn on end_turn and on turn_duration', () => {
    const endTurn = feed([
      prompt('hi'),
      {
        type: 'assistant',
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
      },
    ]);
    expect(transcriptActivity(endTurn).activity).toBe('waiting');
    const duration = feed([
      prompt('hi'),
      toolUse('t1', 'Read', {}),
      toolResult('t1'),
      { type: 'system', subtype: 'turn_duration' },
    ]);
    expect(duration.phase).toBe('turn-ended');
  });

  it('marks a subagent finished when it hands back', () => {
    const state = feed([
      prompt('task'),
      toolUse('h1', 'SubagentHandback', { report: 'x' }),
      toolResult('h1'),
    ]);
    expect(state.phase).toBe('finished');
  });

  it('keeps the latest title and cwd, and ignores junk lines', () => {
    let state = feed([
      { type: 'ai-title', aiTitle: 'Office visualizer' },
      { type: 'user', cwd: '/a/b', message: { content: 'x' } },
    ]);
    state = applyTranscriptLine(state, '{not json', NOW);
    state = applyTranscriptLine(state, '', NOW);
    expect(state.title).toBe('Office visualizer');
    expect(state.cwd).toBe('/a/b');
  });

  it('does not count the same tool call twice', () => {
    const call = toolUse('t1', 'Bash', { command: 'ls' });
    expect(feed([prompt('x'), call, call]).pending).toHaveLength(1);
  });
});

describe('tool activity', () => {
  it('prefers the command description and never shows full commands', () => {
    expect(toolActivity('Bash', { command: 'pnpm test', description: 'Run tests' })).toEqual({
      activity: 'running',
      detail: 'Run tests',
    });
    expect(toolActivity('Bash', { command: 'API_KEY=secret curl https://x' }).detail).toBe('curl');
  });

  it('masks anything that looks like a key or token', () => {
    const detail = toolActivity('Grep', { pattern: 'sk_live_51HxQ2eKa9b8c7d6e5f4g3h2' }).detail;
    expect(detail).toBe('•••');
  });

  it('maps the main tool families', () => {
    expect(toolActivity('Grep', { pattern: 'TODO' }).activity).toBe('reading');
    expect(toolActivity('WebFetch', { url: 'https://docs.stripe.com/a' })).toEqual({
      activity: 'browsing',
      detail: 'docs.stripe.com',
    });
    expect(toolActivity('Agent', { description: 'Review diff' })).toEqual({
      activity: 'delegating',
      detail: 'Review diff',
    });
    expect(toolActivity('AskUserQuestion', {}).activity).toBe('waiting');
    expect(toolActivity('mcp__claude_ai_Vercel__list_projects', {})).toEqual({
      activity: 'browsing',
      detail: 'Vercel',
    });
  });
});

describe('rooms', () => {
  it('folds worktrees and hidden work folders into their project', () => {
    expect(projectRoot('/Users/me/Projects/app/.claude/worktrees/fix')).toBe(
      '/Users/me/Projects/app',
    );
    expect(projectRoot('/Users/me/Projects/leads/.work/sites/w1')).toBe('/Users/me/Projects/leads');
    expect(projectRoot('/Users/me/Projects/app/')).toBe('/Users/me/Projects/app');
  });

  it('matches the transcript folder naming', () => {
    expect(transcriptFolderName('/Users/me/Projects/app/.work')).toBe(
      '-Users-me-Projects-app--work',
    );
  });

  it('disambiguates rooms that share a folder name', () => {
    const rooms = buildRooms(['/a/web', '/b/web', '/a/api'], '/home');
    expect(rooms.map((room) => room.name).sort()).toEqual(['a/web', 'api', 'b/web']);
  });
});
