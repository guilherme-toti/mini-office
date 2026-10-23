import type { Activity } from '../../shared/protocol.ts';
import { format, messages } from '../i18n/index.ts';
import type { HudPerson } from '../game/engine.ts';
import type { StatusIcon } from '../game/gfx/overlay-art.ts';

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return format(messages.time.seconds, { n: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return format(messages.time.minutes, { n: minutes });
  return format(messages.time.hours, { n: Math.round(minutes / 60) });
}

export function activityText(activity: Activity, detail: string | null): string {
  const label = messages.activity[activity];
  return detail ? `${label} · ${detail}` : label;
}

export function needsYou(person: HudPerson): boolean {
  return person.activity === 'waiting';
}

export function hudIcon(person: HudPerson): StatusIcon {
  if (person.whereabouts === 'dozing') return 'sleeping';
  return person.activity;
}

/** "claude-opus-5-5" → "Opus 5.5"; anything else is shown as it comes. */
export function modelName(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!match?.[1] || !match[2]) return model;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  return `${family} ${match[2]}${match[3] ? `.${match[3]}` : ''}`;
}

export function ago(ms: number): string {
  return ms < 10_000 ? messages.card.justNow : format(messages.card.ago, { time: duration(ms) });
}
