import type { Activity, AgentSnapshot, RoomSnapshot } from '../../shared/protocol.ts';
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
    agent.snapshot = {
      ...agent.snapshot,
      activity,
      detail: details ? pick(this.random, details) : null,
      activitySince: now,
    };
    const long = activity === 'waiting' || activity === 'running';
    agent.nextChangeAt = now + between(this.random, long ? 15_000 : 4000, long ? 70_000 : 12_000);
  }

  private delegate(parents: DemoAgent[], helpers: number, now: number): void {
    const parent = parents[0];
    if (!parent) return;
    const task = pick(this.random, HELPER_TASKS);
    parent.snapshot = {
      ...parent.snapshot,
      activity: 'delegating',
      detail: task,
      activitySince: now,
    };
    for (let index = 0; index < helpers; index += 1) {
      this.counter += 1;
      const id = `${parent.snapshot.id}/helper-${this.counter}`;
      this.agents.set(id, {
        snapshot: {
          id,
          kind: 'subagent',
          parentId: parent.snapshot.id,
          roomId: parent.snapshot.roomId,
          label: index === 0 ? task : pick(this.random, HELPER_TASKS),
          role: pick(this.random, HELPER_ROLES),
          activity: 'reading',
          detail: pick(this.random, DETAILS.reading ?? []),
          activitySince: now,
          startedAt: now,
        },
        nextChangeAt: now + between(this.random, 5000, 10_000),
        leavesAt: now + between(this.random, 25_000, 50_000),
      });
    }
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
        agent.snapshot = { ...agent.snapshot, activity: 'thinking', detail: null };
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
