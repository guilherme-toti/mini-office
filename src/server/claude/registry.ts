import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const RegistryEntrySchema = z.looseObject({
  pid: z.number(),
  sessionId: z.string(),
  cwd: z.string(),
  status: z.string().optional(),
  kind: z.string().optional(),
  startedAt: z.number().optional(),
});
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

export interface LiveSessions {
  entries: RegistryEntry[];
  /** Registry files that exist for a running pid but could not be read this time (mid-write). */
  unreadablePids: Set<number>;
}

/**
 * Running Claude Code sessions, from `~/.claude/sessions/<pid>.json`. Only the `.json` files are
 * read; the sibling `.key` files hold peer tokens and are never touched.
 */
export async function readLiveSessions(sessionsDir: string): Promise<LiveSessions> {
  let names: string[];
  try {
    names = await readdir(sessionsDir);
  } catch {
    return { entries: [], unreadablePids: new Set() };
  }
  const unreadablePids = new Set<number>();
  const entries = await Promise.all(
    names
      .filter((name) => /^\d+\.json$/.test(name))
      .map(async (name) => {
        const pid = Number.parseInt(name, 10);
        try {
          const json: unknown = JSON.parse(await readFile(join(sessionsDir, name), 'utf8'));
          const parsed = RegistryEntrySchema.safeParse(json);
          if (parsed.success) return parsed.data;
        } catch {
          // Caught mid-rewrite; decided below.
        }
        if (isProcessAlive(pid)) unreadablePids.add(pid);
        return null;
      }),
  );
  return {
    entries: entries.filter(
      (entry): entry is RegistryEntry => entry !== null && isProcessAlive(entry.pid),
    ),
    unreadablePids,
  };
}

/** The registry says "idle" once a session has finished its turn and waits for the user. */
export function registryWaitsForUser(entry: RegistryEntry): boolean {
  const status = entry.status?.toLowerCase() ?? '';
  return status === 'idle' || /wait|input|permission/.test(status);
}

/** Only an explicit "busy" means a prompt is being worked on; other states ("shell"…) don't. */
export function registryIsBusy(entry: RegistryEntry): boolean {
  return entry.status?.toLowerCase() === 'busy';
}
