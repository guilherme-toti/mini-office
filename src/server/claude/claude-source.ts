import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AgentSnapshot, RoomSnapshot } from '../../shared/protocol.ts';
import { PollingSource } from '../source.ts';
import type { ToolActivity } from './activity.ts';
import {
  readLiveSessions,
  registryIsBusy,
  registryWaitsForUser,
  type LiveSessions,
  type RegistryEntry,
} from './registry.ts';
import { buildRooms, projectRoot, transcriptFolderName } from './rooms.ts';
import { TranscriptTail } from './tail.ts';
import {
  emptyInsight,
  transcriptActivity,
  transcriptInsight,
  type TranscriptState,
} from './transcript.ts';

const TICK_MS = 1000;
/** Headless runs (`claude -p`, SDK) have no registry entry; they are found by recent writes. */
const SCAN_EVERY_TICKS = 5;
/** Folder listings are cached by folder mtime; this forces a full look now and then anyway. */
const FULL_RESCAN_EVERY_TICKS = 30;
const HEADLESS_FRESH_MS = 60_000;
const HEADLESS_DONE_GRACE_MS = 10_000;
const HEADLESS_STALE_MS = 3 * 60_000;
/** A subagent transcript untouched this long belongs to a helper that already went home. */
const SUBAGENT_STALE_MS = 10 * 60_000;
/** Tools can legitimately run quietly for up to 10 minutes (the Bash limit). */
const TOOL_STALE_MS = 12 * 60_000;
const STAT_BATCH = 32;

const SubagentMetaSchema = z.looseObject({
  agentType: z.string().optional(),
  description: z.string().optional(),
});

interface TrackedSubagent {
  agentId: string;
  tail: TranscriptTail;
  role: string | null;
  label: string | null;
  startedAt: number;
}

interface TrackedSession {
  sessionId: string;
  entry: RegistryEntry | null;
  tail: TranscriptTail | null;
  startedAt: number;
  subagents: Map<string, TrackedSubagent>;
}

export interface ClaudeSourceOptions {
  claudeDir?: string;
}

/** Watches the real Claude Code sessions on this machine. */
export class ClaudeSource extends PollingSource {
  readonly name = 'live' as const;
  protected readonly intervalMs = TICK_MS;
  private readonly projectsDir: string;
  private readonly sessionsDir: string;
  private readonly sessions = new Map<string, TrackedSession>();
  /** Subagent transcripts already seen finishing, with the mtime they had then. */
  private readonly finishedSubagents = new Map<string, number>();
  /** Sessions that left, so a just-closed transcript is not re-discovered as headless. */
  private readonly departed = new Map<string, number>();
  private readonly activitySince = new Map<string, { key: string; since: number }>();
  private readonly folderMtimes = new Map<string, number>();
  private ticks = 0;

  constructor(options: ClaudeSourceOptions = {}) {
    super();
    const claudeDir = options.claudeDir ?? join(homedir(), '.claude');
    this.projectsDir = join(claudeDir, 'projects');
    this.sessionsDir = join(claudeDir, 'sessions');
  }

  protected override onStop(): void {
    this.sessions.clear();
    this.activitySince.clear();
    this.folderMtimes.clear();
    this.ticks = 0;
  }

  protected async tick(now: number): Promise<{ rooms: RoomSnapshot[]; agents: AgentSnapshot[] }> {
    const scanning = this.ticks % SCAN_EVERY_TICKS === 0;
    const fullRescan = this.ticks % FULL_RESCAN_EVERY_TICKS === 0;
    this.ticks += 1;

    await this.syncRegistry(await readLiveSessions(this.sessionsDir), now, scanning);
    if (scanning) {
      await this.discoverHeadless(now, fullRescan);
      await this.discoverSubagents(now, fullRescan);
      this.prune(now);
    }
    await Promise.all(
      [...this.sessions.values()].flatMap((session) => [
        ...(session.tail ? [session.tail.poll(now)] : []),
        ...[...session.subagents.values()].map((sub) => sub.tail.poll(now)),
      ]),
    );
    this.retireFinished(now);
    return this.buildSnapshot(now);
  }

  private async syncRegistry(live: LiveSessions, now: number, searchWide: boolean): Promise<void> {
    const liveIds = new Set(live.entries.map((entry) => entry.sessionId));
    for (const [id, session] of this.sessions) {
      if (!session.entry || liveIds.has(id)) continue;
      // A registry file read mid-rewrite is not a session leaving.
      if (live.unreadablePids.has(session.entry.pid)) continue;
      this.depart(id, now);
    }
    for (const entry of live.entries) {
      const existing = this.sessions.get(entry.sessionId);
      if (existing) {
        existing.entry = entry;
        existing.tail ??= await this.findTranscript(entry.sessionId, entry.cwd, searchWide);
        continue;
      }
      this.sessions.set(entry.sessionId, {
        sessionId: entry.sessionId,
        entry,
        tail: await this.findTranscript(entry.sessionId, entry.cwd, true),
        startedAt: entry.startedAt ?? now,
        subagents: new Map(),
      });
    }
  }

  private depart(sessionId: string, now: number): void {
    this.sessions.delete(sessionId);
    this.departed.set(sessionId, now);
  }

  /**
   * The transcript lives in the folder named after the cwd. A brand-new session has none yet,
   * so the wide search across every project folder only runs on scan ticks.
   */
  private async findTranscript(
    sessionId: string,
    cwd: string,
    searchWide: boolean,
  ): Promise<TranscriptTail | null> {
    const expected = join(this.projectsDir, transcriptFolderName(cwd), `${sessionId}.jsonl`);
    if (await exists(expected)) return new TranscriptTail(expected);
    if (!searchWide) return null;
    const candidates = (await listDir(this.projectsDir)).map((folder) =>
      join(this.projectsDir, folder, `${sessionId}.jsonl`),
    );
    const mtimes = await statAll(candidates);
    const found = candidates.find((_, index) => mtimes[index] !== null);
    return found ? new TranscriptTail(found) : null;
  }

  /** True when the folder gained or lost files since the last look (or on a full rescan). */
  private async folderChanged(path: string, fullRescan: boolean): Promise<boolean> {
    const mtime = await modifiedAt(path);
    if (mtime === null) return false;
    const previous = this.folderMtimes.get(path);
    this.folderMtimes.set(path, mtime);
    return fullRescan || previous !== mtime;
  }

  private async discoverHeadless(now: number, fullRescan: boolean): Promise<void> {
    for (const folder of await listDir(this.projectsDir)) {
      const folderPath = join(this.projectsDir, folder);
      if (!(await this.folderChanged(folderPath, fullRescan))) continue;
      const files = (await listDir(folderPath)).filter((file) => file.endsWith('.jsonl'));
      const untracked = files.filter((file) => !this.sessions.has(file.slice(0, -'.jsonl'.length)));
      const paths = untracked.map((file) => join(folderPath, file));
      const mtimes = await statAll(paths);
      paths.forEach((path, index) => {
        const mtime = mtimes[index];
        const sessionId = untracked[index]?.slice(0, -'.jsonl'.length);
        if (!sessionId || mtime == null || now - mtime > HEADLESS_FRESH_MS) return;
        const leftAt = this.departed.get(sessionId);
        if (leftAt !== undefined && mtime <= leftAt) return;
        this.sessions.set(sessionId, {
          sessionId,
          entry: null,
          tail: new TranscriptTail(path),
          startedAt: now,
          subagents: new Map(),
        });
      });
    }
  }

  private async discoverSubagents(now: number, fullRescan: boolean): Promise<void> {
    for (const session of this.sessions.values()) {
      if (!session.tail) continue;
      const dir = join(dirname(session.tail.path), session.sessionId, 'subagents');
      if (!(await this.folderChanged(dir, fullRescan))) continue;
      const fresh = (await listDir(dir)).flatMap((file) => {
        const agentId = /^agent-(.+)\.jsonl$/.exec(file)?.[1];
        return agentId && !session.subagents.has(agentId)
          ? [{ agentId, path: join(dir, file) }]
          : [];
      });
      const mtimes = await statAll(fresh.map((item) => item.path));
      for (const [index, { agentId, path }] of fresh.entries()) {
        const mtime = mtimes[index];
        if (mtime == null || now - mtime > SUBAGENT_STALE_MS) continue;
        const finishedAt = this.finishedSubagents.get(path);
        if (finishedAt !== undefined && mtime <= finishedAt) continue;
        const meta = await readSubagentMeta(join(dir, `agent-${agentId}.meta.json`));
        session.subagents.set(agentId, {
          agentId,
          tail: new TranscriptTail(path),
          role: meta.agentType ?? null,
          label: meta.description ?? null,
          startedAt: now,
        });
      }
    }
  }

  private retireFinished(now: number): void {
    for (const [id, session] of this.sessions) {
      for (const [agentId, sub] of session.subagents) {
        if (isDone(sub.tail.state) || isStale(sub.tail, now, SUBAGENT_STALE_MS)) {
          session.subagents.delete(agentId);
          this.finishedSubagents.set(sub.tail.path, sub.tail.mtimeMs);
        }
      }
      if (session.entry || !session.tail) continue;
      const quietFor = now - session.tail.mtimeMs;
      if (
        (isDone(session.tail.state) && quietFor > HEADLESS_DONE_GRACE_MS) ||
        isStale(session.tail, now, HEADLESS_STALE_MS)
      ) {
        this.depart(id, now);
      }
    }
  }

  /** The mtime checks already skip anything older than these windows, so the memory can go. */
  private prune(now: number): void {
    for (const [id, at] of this.departed)
      if (now - at > HEADLESS_FRESH_MS) this.departed.delete(id);
    for (const [path, mtime] of this.finishedSubagents) {
      if (now - mtime > SUBAGENT_STALE_MS) this.finishedSubagents.delete(path);
    }
  }

  private sessionActivity(session: TrackedSession): ToolActivity {
    const fromTranscript = session.tail
      ? transcriptActivity(session.tail.state)
      : { activity: 'waiting' as const, detail: null };
    if (!session.entry) return fromTranscript;
    if (registryWaitsForUser(session.entry)) return { activity: 'waiting', detail: null };
    // The registry flips to busy before the new prompt reaches the transcript.
    if (registryIsBusy(session.entry) && fromTranscript.activity === 'waiting') {
      return { activity: 'thinking', detail: null };
    }
    return fromTranscript;
  }

  private since(
    id: string,
    { activity, detail }: ToolActivity,
    fallback: number,
    now: number,
  ): number {
    const key = `${activity}:${detail ?? ''}`;
    const previous = this.activitySince.get(id);
    if (previous?.key === key) return previous.since;
    const since = previous ? now : fallback;
    this.activitySince.set(id, { key, since });
    return since;
  }

  private buildSnapshot(now: number): { rooms: RoomSnapshot[]; agents: AgentSnapshot[] } {
    const agents: AgentSnapshot[] = [];
    for (const session of this.sessions.values()) {
      const cwd = session.entry?.cwd ?? session.tail?.state.cwd;
      if (!cwd) continue;
      const roomId = projectRoot(cwd);
      const activity = this.sessionActivity(session);
      const lastEventAt = session.tail?.state.lastEventAt || now;
      agents.push({
        id: session.sessionId,
        kind: 'session',
        parentId: null,
        roomId,
        label: session.tail?.state.title ?? null,
        role: null,
        ...activity,
        activitySince: this.since(session.sessionId, activity, lastEventAt, now),
        startedAt: session.startedAt,
        insight: session.tail ? transcriptInsight(session.tail.state) : emptyInsight(),
      });
      for (const sub of session.subagents.values()) {
        const id = `${session.sessionId}/${sub.agentId}`;
        const subActivity = transcriptActivity(sub.tail.state);
        agents.push({
          id,
          kind: 'subagent',
          parentId: session.sessionId,
          roomId,
          label: sub.label,
          role: sub.role,
          ...subActivity,
          activitySince: this.since(id, subActivity, sub.tail.state.lastEventAt || now, now),
          startedAt: sub.startedAt,
          insight: transcriptInsight(sub.tail.state),
        });
      }
    }
    const present = new Set(agents.map((agent) => agent.id));
    for (const id of this.activitySince.keys()) {
      if (!present.has(id)) this.activitySince.delete(id);
    }
    agents.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    return { rooms: buildRooms(agents.map((agent) => agent.roomId)), agents };
  }
}

function isDone(state: TranscriptState): boolean {
  return state.phase === 'finished' || state.phase === 'turn-ended';
}

/** Quiet for too long; a tool in flight gets the tool's own, longer allowance. */
function isStale(tail: TranscriptTail, now: number, limit: number): boolean {
  const allowance = tail.state.phase === 'tool' ? Math.max(limit, TOOL_STALE_MS) : limit;
  return now - tail.mtimeMs > allowance;
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function modifiedAt(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** Stats many files in parallel batches, so big folders don't serialize thousands of calls. */
async function statAll(paths: readonly string[]): Promise<(number | null)[]> {
  const results: (number | null)[] = [];
  for (let start = 0; start < paths.length; start += STAT_BATCH) {
    results.push(...(await Promise.all(paths.slice(start, start + STAT_BATCH).map(modifiedAt))));
  }
  return results;
}

async function exists(path: string): Promise<boolean> {
  return (await modifiedAt(path)) !== null;
}

async function readSubagentMeta(path: string): Promise<z.infer<typeof SubagentMetaSchema>> {
  try {
    const parsed = SubagentMetaSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
