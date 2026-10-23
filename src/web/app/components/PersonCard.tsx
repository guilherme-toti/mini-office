import type { ReactNode } from 'react';
import type { AgentStep, StepResult } from '../../../shared/protocol.ts';
import { format, messages, plural } from '../../i18n/index.ts';
import type { HudPerson } from '../../game/engine.ts';
import { activityText, ago, duration, hudIcon, modelName, needsYou } from '../format.ts';
import { Button } from './Button.tsx';
import { Portrait, StatusGlyph } from './Sprite.tsx';

interface PersonCardProps {
  person: HudPerson;
  people: HudPerson[];
  now: number;
  onClose: () => void;
  onFocus: (id: string) => void;
}

/** Each result has its own mark, so it reads without color. */
const RESULT_MARK: Record<StepResult, { mark: string; tone: string }> = {
  running: { mark: '●', tone: 'text-sun animate-pulse' },
  ok: { mark: '✓', tone: 'text-mint' },
  failed: { mark: '✕', tone: 'text-coral' },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3">
      <h3 className="text-sm font-bold tracking-wide text-faint uppercase">{title}</h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function Step({ step, now }: { step: AgentStep; now: number }) {
  const { mark, tone } = RESULT_MARK[step.result];
  return (
    <li className="flex items-baseline gap-2 py-0.5">
      <span aria-hidden className={`w-4 shrink-0 text-center ${tone}`}>
        {mark}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-cream">
        {activityText(step.activity, step.detail)}
        {step.result === 'failed' ? (
          <span className="text-coral"> · {messages.card.result.failed}</span>
        ) : null}
        <span className="sr-only"> · {messages.card.result[step.result]}</span>
      </span>
      <span className="shrink-0 text-sm text-faint">{ago(now - step.at)}</span>
    </li>
  );
}

/** Everything known about the selected person: what they were asked, said and did. */
export function PersonCard({ person, people, now, onClose, onFocus }: PersonCardProps) {
  const waiting = needsYou(person);
  const { insight } = person;
  const helpers = people.filter((other) => other.parentId === person.id);
  const subagent = person.kind === 'subagent';
  const facts = [
    insight.branch ? `⎇ ${insight.branch}` : null,
    insight.model ? modelName(insight.model) : null,
    insight.counts.steps > 0
      ? `${plural(messages.card.stepCount, insight.counts.steps)} · ${plural(messages.card.commandCount, insight.counts.commands)}`
      : null,
    insight.counts.failures > 0
      ? format(messages.card.failures, { count: insight.counts.failures })
      : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <article
      className="panel max-h-[55dvh] overflow-y-auto p-3 lg:max-h-[calc(100dvh-220px)]"
      aria-label={person.name}
    >
      <header className="flex items-start gap-3">
        <div className="rounded-lg bg-panel-raised p-2">
          <Portrait look={person.look} badge={subagent} zoom={3} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold text-cream">{person.name}</h2>
              <p className="text-sm text-muted">
                {person.parentName
                  ? format(messages.panel.helperOf, { name: person.parentName })
                  : messages.panel.session}
                {person.role ? ` · ${person.role}` : ''}
              </p>
              <p className="text-sm text-muted">
                {person.roomName} · {messages.whereabouts[person.whereabouts]}
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
            <span className="min-w-0 flex-1 truncate">
              {activityText(person.activity, person.detail)}
            </span>
            <span className="shrink-0 text-sm text-faint">
              {format(messages.panel.since, { time: duration(now - person.activitySince) })}
            </span>
          </p>
        </div>
      </header>

      {person.label ? (
        <p className="mt-2 text-sm text-muted">
          <span className="text-faint">{messages.card.task}:</span> {person.label}
        </p>
      ) : null}

      {insight.prompt ? (
        <Section title={subagent ? messages.card.brief : messages.card.asked}>
          <p className="line-clamp-4 border-l-2 border-panel-edge pl-2 text-base text-cream italic pointer-fine:text-sm">
            {insight.prompt}
          </p>
        </Section>
      ) : null}

      {insight.said ? (
        <Section title={messages.card.said}>
          <p className="line-clamp-4 rounded-lg bg-bubble px-2 py-1 text-base text-ink pointer-fine:text-sm">
            {insight.said}
          </p>
        </Section>
      ) : null}

      <Section title={messages.card.steps}>
        {insight.steps.length > 0 ? (
          <ol>
            {insight.steps.map((step) => (
              <Step
                key={`${step.at}-${step.activity}-${step.detail ?? ''}`}
                step={step}
                now={now}
              />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-faint">{messages.card.noSteps}</p>
        )}
      </Section>

      {insight.files.length > 0 ? (
        <Section title={messages.card.files}>
          <ul className="flex flex-wrap gap-1">
            {insight.files.map((file) => (
              <li key={file} className="rounded bg-panel-raised px-1.5 text-sm text-cream">
                {file}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {helpers.length > 0 ? (
        <Section title={messages.card.helpers}>
          <ul className="flex flex-col gap-1">
            {helpers.map((helper) => (
              <li key={helper.id}>
                <button
                  type="button"
                  onClick={() => onFocus(helper.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-sun"
                >
                  <Portrait look={helper.look} badge zoom={1} />
                  <span className="min-w-0 flex-1 truncate text-sm text-cream">
                    {helper.name}
                    {helper.role ? <span className="text-muted"> · {helper.role}</span> : null}
                  </span>
                  <span className="min-w-0 max-w-[50%] truncate text-sm text-muted">
                    {activityText(helper.activity, helper.detail)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {facts.length > 0 ? (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t-2 border-ink pt-2 text-sm text-faint">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
      ) : null}
    </article>
  );
}
