import type { Activity, AgentInsight, AgentSnapshot, RoomSnapshot } from '../../shared/protocol.ts';
import { between, createRandom, pick } from '../../shared/random.ts';
import { PollingSource } from '../source.ts';

const PROJECTS = ['storefront', 'billing-api', 'mobile-app', 'design-system', 'data-pipeline'];
const MAX_SESSIONS = 12;

const DETAILS: Partial<Record<Activity, readonly string[]>> = {
  editing: ['checkout.tsx', 'invoice.service.ts', 'schema.prisma', 'Button.tsx', 'pipeline.py'],
  reading: ['README.md', 'routes.ts', 'package.json', 'migrations', 'useCart.ts'],
  running: ['Run the test suite', 'Install dependencies', 'Build for production', 'Lint the repo'],
  browsing: ['docs.stripe.com', 'react.dev', 'Postgres upsert syntax'],
  delegating: ['Review the checkout diff'],
};
const WEIGHTS: [Activity, number][] = [
  ['editing', 0.3],
  ['reading', 0.2],
  ['running', 0.15],
  ['thinking', 0.15],
  ['browsing', 0.06],
  ['planning', 0.04],
  ['waiting', 0.1],
];
const HELPER_ACTIVITIES: readonly Activity[] = ['reading', 'editing', 'running', 'thinking'];
const HELPER_ROLES = ['Explore', 'reviewer', 'frontend-dev', 'backend-dev', 'browser'];
const HELPER_TASKS = [
  'Find where totals are computed',
  'Review the payment changes',
  'Check the page on mobile',
  'Write the migration tests',
];

const PROMPTS = [
  'Add Apple Pay to the checkout and keep the old card flow working',
  'The invoice tests fail every other run. Find out why and fix it',
  'Make the settings screen work offline',
  'Move the orders table to UUID keys without downtime',
  'Polish the empty states on the dashboard',
];
const BRANCHES = ['main', 'feat/apple-pay', 'fix/invoice-tests', 'chore/uuid-keys'];
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];
const SAID: Record<Activity, string> = {
  editing: 'Updating {detail} so the totals include tax.',
  reading: 'Let me look at how {detail} is wired before changing it.',
  running: 'Running this to make sure nothing broke.',
  browsing: 'Checking the docs for the right way to do this.',
  thinking: 'I think the bug is in the rounding step. Checking that next.',
  planning: 'Splitting this into three smaller steps.',
  delegating: 'Asking a helper to take part of this.',
  waiting: 'Done. Checkout now takes Apple Pay and the tests pass. Want me to open a PR?',
};
/** Activities that are a tool call, so they show up as a step on the person card. */
const STEP_ACTIVITIES = new Set<Activity>([
  'editing',
  'reading',
  'running',
  'browsing',
  'delegating',
]);

/** What a demo agent's card would say after it moves on to a new activity. */
function advance(
  insight: AgentInsight,
  activity: Activity,
  detail: string | null,
  now: number,
  random: () => number,
): AgentInsight {
  const steps = insight.steps.map((step, index) =>
    index === 0 && step.result === 'running'
      ? {
          ...step,
          result:
            step.activity === 'running' && random() < 0.15 ? ('failed' as const) : ('ok' as const),
        }
      : step,
  );
  const failed = steps[0]?.result === 'failed' && insight.steps[0]?.result === 'running' ? 1 : 0;
  const isStep = STEP_ACTIVITIES.has(activity);
  return {
    ...insight,
    said: SAID[activity].replace('{detail}', detail ?? 'this'),
    steps: isStep
      ? [{ activity, detail, at: now, result: 'running' as const }, ...steps].slice(0, 8)
      : steps,
    files:
      activity === 'editing' && detail
        ? [detail, ...insight.files.filter((file) => file !== detail)].slice(0, 6)
        : insight.files,
    counts: {
      steps: insight.counts.steps + (isStep ? 1 : 0),
      commands: insight.counts.commands + (activity === 'running' ? 1 : 0),
      failures: insight.counts.failures + failed,
    },
  };
}

interface DemoAgent {
  snapshot: AgentSnapshot;
  nextChangeAt: number;
  leavesAt: number | null;
}

/** A scripted office for trying Mini Office without live agents (`?source=demo`). */
export class DemoSource extends PollingSource {
  readonly name = 'demo' as const;
  protected readonly intervalMs = 1000;
  private random = createRandom(7);
  private agents = new Map<string, DemoAgent>();
  private counter = 0;
  private startedAt = 0;
  private rushDone = false;

  protected override onStop(): void {
    this.random = createRandom(7);
    this.agents.clear();
    this.counter = 0;
    this.startedAt = 0;
    this.rushDone = false;
  }

  protected tick(now: number): Promise<{ rooms: RoomSnapshot[]; agents: AgentSnapshot[] }> {
    if (this.startedAt === 0) this.open(now);
    const elapsed = now - this.startedAt;

    for (const [id, agent] of this.agents) {
      if (agent.leavesAt !== null && now >= agent.leavesAt) {
        this.agents.delete(id);
        continue;
      }
      if (now >= agent.nextChangeAt) this.change(agent, now);
    }
    this.settleDelegators(now);

    // A busy stretch a little after opening, so the room has to grow.
    if (elapsed > 20_000 && !this.rushDone) {
      this.rushDone = true;
      this.delegate(this.sessionsIn(PROJECTS[0]), 4, now);
    }
    if (this.random() < 0.02 && this.sessions().length < MAX_SESSIONS) {
      this.addSession(pick(this.random, PROJECTS.slice(0, 4)), now);
    }
    if (this.random() < 0.006) {
      const leaving = this.sessions().find((agent) => agent.snapshot.activity === 'waiting');
      if (leaving && this.sessions().length > 3) leaving.leavesAt = now;
    }

    const agents = [...this.agents.values()].map((agent) => agent.snapshot);
    const roomIds = new Set(agents.map((agent) => agent.roomId));
    const rooms = PROJECTS.filter((name) => roomIds.has(roomId(name))).map((name) => ({
      id: roomId(name),
      name,
    }));
    return Promise.resolve({ rooms, agents });
  }

  private open(now: number): void {
    this.startedAt = now;
    const opening: [string, number][] = [
      [PROJECTS[0] ?? 'storefront', 2],
      [PROJECTS[1] ?? 'billing-api', 1],
      [PROJECTS[2] ?? 'mobile-app', 3],
    ];
    for (const [project, count] of opening) {
      for (let index = 0; index < count; index += 1) this.addSession(project, now);
    }
  }

  private sessions(): DemoAgent[] {
    return [...this.agents.values()].filter((agent) => agent.snapshot.kind === 'session');
  }

  private sessionsIn(project: string | undefined): DemoAgent[] {
    return this.sessions().filter((agent) => agent.snapshot.roomId === roomId(project ?? ''));
  }

  private addSession(project: string, now: number): void {
    this.counter += 1;
    const id = `demo-${this.counter}`;
    this.agents.set(id, {
      snapshot: {
        id,
        kind: 'session',
        parentId: null,
        roomId: roomId(project),
        label: `Work on ${project}`,
        role: null,
        activity: 'thinking',
        detail: null,
        activitySince: now,
        startedAt: now,
        insight: {
          prompt: pick(this.random, PROMPTS),
          said: SAID.thinking,
          steps: [],
          files: [],
          counts: { steps: 0, commands: 0, failures: 0 },
          branch: pick(this.random, BRANCHES),
          model: pick(this.random, MODELS),
        },
      },
      nextChangeAt: now + between(this.random, 4000, 9000),
      leavesAt: null,
    });
  }

  private change(agent: DemoAgent, now: number): void {
    if (agent.snapshot.activity === 'delegating') return;
    const helper = agent.snapshot.kind === 'subagent';
    if (!helper && this.random() < 0.08) {
      this.delegate([agent], 1 + Math.floor(this.random() * 2), now);
      return;
    }
    const activity = helper ? pick(this.random, HELPER_ACTIVITIES) : weighted(this.random, WEIGHTS);
    const details = DETAILS[activity];
    this.setActivity(agent, activity, details ? pick(this.random, details) : null, now);
    const long = activity === 'waiting' || activity === 'running';
    agent.nextChangeAt = now + between(this.random, long ? 15_000 : 4000, long ? 70_000 : 12_000);
  }

  private delegate(parents: DemoAgent[], helpers: number, now: number): void {
    const parent = parents[0];
    if (!parent) return;
    const task = pick(this.random, HELPER_TASKS);
    this.setActivity(parent, 'delegating', task, now);
    for (let index = 0; index < helpers; index += 1) {
      this.counter += 1;
      const id = `${parent.snapshot.id}/helper-${this.counter}`;
      const label = index === 0 ? task : pick(this.random, HELPER_TASKS);
      const detail = pick(this.random, DETAILS.reading ?? []);
      this.agents.set(id, {
        snapshot: {
          id,
          kind: 'subagent',
          parentId: parent.snapshot.id,
          roomId: parent.snapshot.roomId,
          label,
          role: pick(this.random, HELPER_ROLES),
          activity: 'reading',
          detail,
          activitySince: now,
          startedAt: now,
          insight: advance(
            {
              ...parent.snapshot.insight,
              prompt: `${label}. Report back with what you find.`,
              steps: [],
              files: [],
              counts: { steps: 0, commands: 0, failures: 0 },
            },
            'reading',
            detail,
            now,
            this.random,
          ),
        },
        nextChangeAt: now + between(this.random, 5000, 10_000),
        leavesAt: now + between(this.random, 25_000, 50_000),
      });
    }
  }

  private setActivity(
    agent: DemoAgent,
    activity: Activity,
    detail: string | null,
    now: number,
  ): void {
    agent.snapshot = {
      ...agent.snapshot,
      activity,
      detail,
      activitySince: now,
      insight: advance(agent.snapshot.insight, activity, detail, now, this.random),
    };
  }

  /** A parent stops delegating once its last helper has gone home. */
  private settleDelegators(now: number): void {
    const parentsWithHelpers = new Set(
      [...this.agents.values()].flatMap((agent) =>
        agent.snapshot.parentId ? [agent.snapshot.parentId] : [],
      ),
    );
    for (const agent of this.sessions()) {
      if (agent.snapshot.activity === 'delegating' && !parentsWithHelpers.has(agent.snapshot.id)) {
        agent.nextChangeAt = now;
        this.setActivity(agent, 'thinking', null, now);
      }
    }
  }
}

function roomId(project: string): string {
  return `/demo/${project}`;
}

function weighted<T>(random: () => number, entries: [T, number][]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  const last = entries.at(-1);
  if (!last) throw new Error('weighted() needs entries');
  return last[0];
}
