import { format, messages } from '../../i18n/index.ts';
import type { LogEntry } from '../../game/sim/types.ts';

const VISIBLE = 4;
const FRESH_MS = 20_000;

/** The last few things that happened, fading out as they get old. */
export function ActivityLog({ log, now }: { log: LogEntry[]; now: number }) {
  const fresh = log.filter((entry) => now - entry.at < FRESH_MS).slice(0, VISIBLE);
  if (fresh.length === 0) return null;
  return (
    <ol className="pointer-events-none flex flex-col-reverse gap-1" aria-live="polite">
      {fresh.map((entry) => (
        <li
          key={entry.id}
          className="w-fit rounded-md bg-ink/80 px-2 py-1 text-sm text-cream"
          style={{ opacity: Math.max(0.25, 1 - (now - entry.at) / FRESH_MS) }}
        >
          {format(messages.log[entry.kind], entry.params)}
        </li>
      ))}
    </ol>
  );
}
