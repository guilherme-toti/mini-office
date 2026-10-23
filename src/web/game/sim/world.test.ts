import { describe, expect, it } from 'vitest';
import type { AgentSnapshot, OfficeSnapshot } from '../../../shared/protocol.ts';
import { en } from '../../i18n/en.ts';
import { COMMONS_W } from '../layout/floor-plan.ts';
import { createPersona, distinctName } from './persona.ts';
import { World } from './world.ts';

const START = 1_800_000_000_000;

function agent(id: string, overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id,
    kind: 'session',
    parentId: null,
    roomId: '/p/app',
    label: null,
    role: null,
    activity: 'editing',
    detail: 'app.ts',
    activitySince: START,
    startedAt: START,
    insight: {
      prompt: null,
      said: null,
      steps: [],
      files: [],
      counts: { steps: 0, commands: 0, failures: 0 },
      branch: null,
      model: null,
    },
    ...overrides,
  };
}

function snapshot(agents: AgentSnapshot[], at: number): OfficeSnapshot {
  const rooms = [...new Set(agents.map((item) => item.roomId))].map((id) => ({
    id,
    name: id.split('/').at(-1) ?? id,
  }));
  return { source: 'demo', at, rooms, agents };
}

/**
 * Runs the world for `seconds`. Like the server, a snapshot is only sent when the office
 * changes: once at the start, then never again until the caller sends a new one.
 */
function run(world: World, agents: AgentSnapshot[], from: number, seconds: number): number {
  let now = from;
  world.applySnapshot(snapshot(agents, now), now);
  for (let frame = 0; frame < seconds * 20; frame += 1) {
    now += 50;
    world.tick(0.05, now);
  }
  return now;
}

function zoneOf(world: World, id: string) {
  const person = world.people.get(id);
  return person ? world.zoneAt(person.x, person.y) : undefined;
}

describe('personas', () => {
  it('are stable per agent and tell twins apart', () => {
    expect(createPersona('abc')).toEqual(createPersona('abc'));
    const persona = createPersona('abc');
    expect(distinctName(persona, 'abc', new Set([persona.name]))).not.toBe(persona.name);
  });
});

describe('world', () => {
  it('seats everyone who was already working when the page opened', () => {
    const world = new World({ say: en.say, seed: 1 });
    run(world, [agent('a'), agent('b'), agent('c', { roomId: '/p/api' })], START, 1);
    for (const person of world.people.values()) {
      expect(person.stage).toBe('present');
      expect(person.dest?.goal).toBe('desk');
      expect(zoneOf(world, person.id)?.id).toBe(person.home);
    }
  });

  it('walks a newcomer in through the main door to a desk', () => {
    const world = new World({ say: en.say, seed: 1 });
    const now = run(world, [agent('a')], START, 1);
    run(world, [agent('a'), agent('b', { activitySince: now })], now, 15);
    expect(zoneOf(world, 'b')?.id).toBe('/p/app');
    expect(world.log.some((entry) => entry.kind === 'joined')).toBe(true);
  });

  it('builds an area for a new project while the newcomer waits in the commons', () => {
    const world = new World({ say: en.say, seed: 2 });
    let now = run(world, [agent('a')], START, 1);
    const team = [agent('a'), agent('n', { roomId: '/p/new', activitySince: now })];
    now = run(world, team, now, 2);
    expect(world.renovation).not.toBeNull();
    run(world, team, now, 25);
    expect(world.renovation).toBeNull();
    expect(world.floor.zones.some((zone) => zone.id === '/p/new')).toBe(true);
    expect(zoneOf(world, 'n')?.id).toBe('/p/new');
  });

  it('grows a full area: its people step out, it rebuilds, and they come back', () => {
    const world = new World({ say: en.say, seed: 2 });
    const team = [agent('a'), agent('b')];
    let now = run(world, team, START, 2);
    const tierBefore = world.teams.get('/p/app')?.tier ?? -1;
    const bigger = [
      ...team,
      agent('c', { activitySince: now }),
      agent('d', { activitySince: now }),
    ];
    now = run(world, bigger, now, 2);
    expect(world.renovation?.zones.has('/p/app')).toBe(true);
    run(world, bigger, now, 30);
    expect(world.renovation).toBeNull();
    expect(world.teams.get('/p/app')?.tier).toBeGreaterThan(tierBefore);
    const atDesks = [...world.people.values()].filter(
      (person) => person.dest?.goal === 'desk' && zoneOf(world, person.id)?.id === '/p/app',
    );
    expect(atDesks).toHaveLength(4);
    expect(world.log.some((entry) => entry.kind === 'growing')).toBe(true);
  });

  it('sends a finished agent off to play, then calls them back for new work', () => {
    const world = new World({ say: en.say, seed: 3 });
    let now = run(world, [agent('a'), agent('b')], START, 1);
    const waiting = [agent('a', { activity: 'waiting', activitySince: now }), agent('b')];
    now = run(world, waiting, now, 60);
    const person = world.people.get('a');
    expect(person && person.x < COMMONS_W).toBe(true);
    expect(person?.dest?.goal).toBe('commons');
    run(world, [agent('a', { activity: 'editing', activitySince: now }), agent('b')], now, 20);
    expect(world.people.get('a')?.dest?.goal).toBe('desk');
    expect(zoneOf(world, 'a')?.id).toBe('/p/app');
  });

  it('briefs a new helper in the meeting room, then lets it report back before leaving', () => {
    const world = new World({ say: en.say, seed: 4 });
    const parent = agent('p', { activity: 'delegating' });
    let now = run(world, [parent], START, 1);
    const helper = agent('p/h', {
      kind: 'subagent',
      parentId: 'p',
      label: 'Check the tests',
      activitySince: now,
    });
    let sawMeeting = false;
    for (let second = 0; second < 30 && !world.people.get('p/h')?.briefed; second += 1) {
      now = run(world, [parent, helper], now, 1);
      if (zoneOf(world, 'p/h')?.kind === 'meeting' && zoneOf(world, 'p')?.kind === 'meeting') {
        sawMeeting = true;
      }
    }
    expect(world.people.get('p/h')?.briefed).toBe(true);
    expect(sawMeeting).toBe(true);
    run(world, [parent], now, 40);
    expect(world.people.has('p/h')).toBe(false);
    expect(world.log.some((entry) => entry.kind === 'left')).toBe(true);
  });

  it('closes the area of a project nobody works on any more', () => {
    const world = new World({ say: en.say, seed: 5 });
    const now = run(world, [agent('a'), agent('b', { roomId: '/p/other' })], START, 1);
    run(world, [agent('a')], now, 90);
    expect(world.floor.zones.some((zone) => zone.id === '/p/other')).toBe(false);
    expect(world.teams.has('/p/other')).toBe(false);
    expect(world.floor.zones.some((zone) => zone.id === '/p/app')).toBe(true);
  });

  it('lets someone who comes back mid-exit walk on instead of vanishing', () => {
    const world = new World({ say: en.say, seed: 6 });
    let now = run(world, [agent('a'), agent('b')], START, 1);
    now = run(world, [agent('a')], now, 1);
    run(world, [agent('a'), agent('b')], now, 10);
    expect(world.people.get('b')?.stage).toBe('present');
  });
});
