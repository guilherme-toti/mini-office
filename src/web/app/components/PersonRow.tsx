import { messages } from '../../i18n/index.ts';
import type { HudPerson } from '../../game/engine.ts';
import { activityText, duration, hudIcon, needsYou } from '../format.ts';
import { Portrait, StatusGlyph } from './Sprite.tsx';

interface PersonRowProps {
  person: HudPerson;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function PersonRow({ person, now, selected, onSelect }: PersonRowProps) {
  const waiting = needsYou(person);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(person.id)}
        aria-pressed={selected}
        className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-sun ${
          selected ? 'bg-panel-raised shadow-chip' : 'hover:bg-panel-raised/60'
        } ${person.kind === 'subagent' ? 'pl-6' : ''}`}
      >
        <Portrait look={person.look} badge={person.kind === 'subagent'} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-base font-medium text-cream">{person.name}</span>
            {person.role ? (
              <span className="truncate rounded bg-panel-edge px-1.5 text-sm text-muted">
                {person.role}
              </span>
            ) : null}
          </span>
          <span className={`block truncate text-sm ${waiting ? 'text-sun' : 'text-muted'}`}>
            {activityText(person.activity, person.detail)}
          </span>
          <span className="block truncate text-sm text-faint">
            {messages.whereabouts[person.whereabouts]} · {duration(now - person.activitySince)}
          </span>
        </span>
        <StatusGlyph icon={hudIcon(person)} label={messages.activity[person.activity]} />
      </button>
    </li>
  );
}
