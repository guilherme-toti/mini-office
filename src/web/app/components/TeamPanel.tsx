import type { SourceName } from '../../../shared/protocol.ts';
import { format, messages } from '../../i18n/index.ts';
import type { HudPerson, HudRoom } from '../../game/engine.ts';
import { Button } from './Button.tsx';
import { PersonRow } from './PersonRow.tsx';

interface TeamPanelProps {
  people: HudPerson[];
  rooms: HudRoom[];
  now: number;
  selectedId: string | null;
  source: SourceName;
  onSelect: (id: string) => void;
  onTryDemo: () => void;
}

/** Everyone in the office, grouped by room, with helpers listed under the person they help. */
export function TeamPanel({
  people,
  rooms,
  now,
  selectedId,
  source,
  onSelect,
  onTryDemo,
}: TeamPanelProps) {
  if (people.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="text-base text-cream">{messages.panel.empty}</p>
        <p className="text-sm text-muted">{messages.panel.emptyHint}</p>
        {source === 'live' ? (
          <Button variant="primary" onClick={onTryDemo}>
            {messages.source.switchToDemo}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      {rooms.map((room) => {
        const members = orderByTeam(people.filter((person) => person.roomId === room.id));
        if (members.length === 0) return null;
        const renovating = room.phase === 'renovating';
        return (
          <section key={room.id} aria-label={room.name}>
            <h3 className="flex items-center gap-2 px-2 pb-1 text-sm font-bold tracking-wide text-muted uppercase">
              <span className="truncate">{room.name}</span>
              <span className="rounded bg-panel-raised px-1.5 text-cream">
                {format(messages.room.people, { count: room.count })}
              </span>
              {renovating ? (
                <span className="rounded border border-dashed border-sun px-1.5 text-sun normal-case">
                  {messages.room.renovating}
                </span>
              ) : null}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {members.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  now={now}
                  selected={person.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function orderByTeam(members: HudPerson[]): HudPerson[] {
  const sessions = members.filter((person) => person.kind === 'session');
  const helpers = members.filter((person) => person.kind === 'subagent');
  const ordered: HudPerson[] = [];
  for (const session of sessions) {
    ordered.push(session, ...helpers.filter((helper) => helper.parentName === session.name));
  }
  const placed = new Set(ordered.map((person) => person.id));
  return [...ordered, ...helpers.filter((helper) => !placed.has(helper.id))];
}
