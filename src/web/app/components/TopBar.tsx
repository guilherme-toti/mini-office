import type { Ref } from 'react';
import type { SourceName } from '../../../shared/protocol.ts';
import { format, messages } from '../../i18n/index.ts';
import type { HudPerson } from '../../game/engine.ts';
import { needsYou } from '../format.ts';
import type { ConnectionStatus } from '../use-office-feed.ts';
import { Button } from './Button.tsx';
import { StatusGlyph } from './Sprite.tsx';

const STATUS_DOT: Record<ConnectionStatus, string> = {
  live: 'bg-mint',
  connecting: 'bg-sun animate-pulse',
  offline: 'bg-coral',
};

const STATUS_SHAPE: Record<ConnectionStatus, string> = {
  live: 'rounded-full',
  connecting: 'rounded-full',
  offline: 'rounded-none rotate-45',
};

interface TopBarProps {
  headerRef: Ref<HTMLElement>;
  status: ConnectionStatus;
  source: SourceName;
  people: HudPerson[];
  onSourceChange: (source: SourceName) => void;
  onFocus: (id: string) => void;
}

export function TopBar({
  headerRef,
  status,
  source,
  people,
  onSourceChange,
  onFocus,
}: TopBarProps) {
  const waiting = people.filter(needsYou);
  const firstWaiting = waiting[0];
  return (
    <header
      ref={headerRef}
      className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start gap-2 p-3 lg:p-4"
    >
      <div className="panel pointer-events-auto flex items-center gap-3 px-3 py-2">
        <div className="leading-tight">
          <h1 className="text-lg font-bold tracking-wide text-sun">{messages.app.title}</h1>
          <p className={`text-sm text-muted ${source === 'demo' ? 'block' : 'hidden sm:block'}`}>
            {source === 'demo' ? messages.source.demo : messages.app.tagline}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-sm text-muted" role="status">
          <span className={`size-2.5 ${STATUS_DOT[status]} ${STATUS_SHAPE[status]}`} aria-hidden />
          {messages.connection[status]}
        </span>
      </div>

      <div className="panel pointer-events-auto flex items-center gap-1 px-2 py-1.5">
        <span className="px-1.5 text-base text-cream pointer-fine:text-sm">
          {format(messages.summary.people, { count: people.length })}
        </span>
        {firstWaiting ? (
          <Button variant="ghost" className="text-sun" onClick={() => onFocus(firstWaiting.id)}>
            <StatusGlyph icon="waiting" zoom={1} />
            {waiting.length === 1
              ? messages.summary.needYouOne
              : format(messages.summary.needYou, { count: waiting.length })}
          </Button>
        ) : null}
      </div>

      <div className="pointer-events-auto ml-auto">
        <Button variant="quiet" onClick={() => onSourceChange(source === 'live' ? 'demo' : 'live')}>
          {source === 'live' ? messages.source.switchToDemo : messages.source.switchToLive}
        </Button>
      </div>
    </header>
  );
}
