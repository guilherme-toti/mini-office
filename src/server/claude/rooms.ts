import { homedir } from 'node:os';
import { basename, dirname } from 'node:path';
import type { RoomSnapshot } from '../../shared/protocol.ts';

/**
 * A folder inside a hidden directory (`.claude/worktrees/x`, `.worktrees/x`, `.work/sites/x`)
 * belongs to the project that holds it, so its agents share that project's room.
 */
export function projectRoot(cwd: string): string {
  const segments = cwd.split('/');
  const hidden = segments.findIndex((segment, index) => index > 1 && segment.startsWith('.'));
  const kept = hidden > 0 ? segments.slice(0, hidden) : segments;
  return kept.join('/').replace(/\/+$/, '') || '/';
}

/**
 * Claude Code stores each cwd's transcripts in a folder named after the path, with every
 * character that isn't a letter or digit turned into a dash.
 */
export function transcriptFolderName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function displayName(path: string, home: string): string {
  if (path === home) return '~';
  return basename(path) || path;
}

/** Room names are folder names; two folders with the same name get their parent as a prefix. */
export function buildRooms(paths: Iterable<string>, home = homedir()): RoomSnapshot[] {
  const unique = [...new Set(paths)].sort();
  const counts = new Map<string, number>();
  for (const path of unique) {
    const name = displayName(path, home);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return unique.map((path) => {
    const name = displayName(path, home);
    const clash = (counts.get(name) ?? 0) > 1;
    return {
      id: path,
      name: clash ? `${basename(dirname(path))}/${name}` : name,
    };
  });
}
