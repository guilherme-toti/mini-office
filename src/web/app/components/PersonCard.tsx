import { format, messages } from '../../i18n/index.ts';
import type { HudPerson } from '../../game/engine.ts';
import { activityText, duration, hudIcon, needsYou } from '../format.ts';
import { Button } from './Button.tsx';
import { Portrait, StatusGlyph } from './Sprite.tsx';

interface PersonCardProps {
  person: HudPerson;
  now: number;
  onClose: () => void;
}

/** Details for the selected person, like a Habbo profile card. */
export function PersonCard({ person, now, onClose }: PersonCardProps) {
  const waiting = needsYou(person);
  return (
    <article className="panel flex gap-3 p-3" aria-label={person.name}>
      <div className="flex flex-col items-center gap-2 rounded-lg bg-panel-raised p-2">
        <Portrait look={person.look} badge={person.kind === 'subagent'} zoom={3} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold text-cream">{person.name}</h2>
            <p className="text-sm text-muted">
              {person.parentName
                ? format(messages.panel.helperOf, { name: person.parentName })
                : messages.panel.session}
            </p>
          </div>
          <Button
            variant="ghost"
            aria-label={messages.panel.close}
            className="size-10 px-0"
            onClick={onClose}
          >
            <span aria-hidden className="text-xl leading-none">
              ×
            </span>
          </Button>
        </div>
        <p
          className={`mt-2 flex items-center gap-2 text-base ${waiting ? 'text-sun' : 'text-cream'}`}
        >
          <StatusGlyph icon={hudIcon(person)} zoom={1} />
          <span className="min-w-0 truncate">{activityText(person.activity, person.detail)}</span>
          <span className="shrink-0 text-sm text-faint">
            {format(messages.panel.since, { time: duration(now - person.activitySince) })}
          </span>
        </p>
        {person.label ? (
          <p className="mt-1 text-sm text-muted">
            <span className="text-faint">{messages.card.task}:</span> {person.label}
          </p>
        ) : null}
        <p className="mt-1 text-sm text-muted">
          <span className="text-faint">{messages.card.room}:</span> {person.roomName} ·{' '}
          {messages.whereabouts[person.whereabouts]}
        </p>
      </div>
    </article>
  );
}
