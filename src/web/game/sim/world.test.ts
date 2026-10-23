import { describe, expect, it } from 'vitest';
import type { AgentSnapshot, OfficeSnapshot } from '../../../shared/protocol.ts';
import { en } from '../../i18n/en.ts';
import { createPersona, distinctName } from './persona.ts';
import { LOUNGE_ID } from './types.ts';
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

/** Runs the world for `seconds`, re-sending the same snapshot every second like the server. */
function run(world: World, agents: AgentSnapshot[], from: number, seconds: number): number {
  let now = from;
  for (let second = 0; second < seconds; second += 1) {
    world.applySnapshot(snapshot(agents, now), now);
    for (let frame = 0; frame < 20; frame += 1) {
      now += 50;
      world.tick(0.05, now);
    }
  }
  return now;
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
    run(world, [agent('a'), agent('b')], START, 1);
    for (const person of world.people.values()) {
      expect(person.stage).toBe('present');
      expect(person.dest?.goal).toBe('desk');
    }
  });

  it('walks a newcomer in through the door and greets the room', () => {
    const world = new World({ say: en.say, seed: 1 });
    let now = run(world, [agent('a')], START, 1);
    now = run(world, [agent('a'), agent('b', { activitySince: now })], now, 8);
    const newcomer = world.people.get('b');
    expect(newcomer?.room).toBe('/p/app');
    expect(world.log.some((entry) => entry.kind === 'joined')).toBe(true);
    expect(now).toBeGreaterThan(START);
  });

  it('grows a full room: everyone steps out, it rebuilds, and they come back', () => {
    const world = new World({ say: en.say, seed: 2 });
    const team = [agent('a'), agent('b')];
    let now = run(world, team, START, 2);
    const room = world.rooms.get('/p/app');
    const tierBefore = room?.layout.tier ?? -1;
    const bigger = [
      ...team,
      agent('c', { activitySince: now }),
      agent('d', { activitySince: now }),
    ];
    now = run(world, bigger, now, 3);
    expect(['evacuating', 'building']).toContain(world.rooms.get('/p/app')?.phase);
    run(world, bigger, now, 25);
    const after = world.rooms.get('/p/app');
    expect(after?.phase).toBe('open');
    expect(after?.layout.tier).toBeGreaterThan(tierBefore);
    expect(after?.layout.desks.length).toBeGreaterThanOrEqual(4);
    const atDesks = [...world.people.values()].filter(
      (person) => person.room === '/p/app' && person.dest?.goal === 'desk',
    );
    expect(atDesks).toHaveLength(4);
    expect(world.log.some((entry) => entry.kind === 'growing')).toBe(true);
  });

  it('sends a finished agent for coffee, then wakes them for new work', () => {
    const world = new World({ say: en.say, seed: 3 });
    let now = run(world, [agent('a'), agent('b')], START, 1);
    const waitingSince = now;
    now = run(
      world,
      [agent('a', { activity: 'waiting', activitySince: waitingSince }), agent('b')],
      now,
      60,
    );
    expect(world.people.get('a')?.room).toBe(LOUNGE_ID);
    run(world, [agent('a', { activity: 'editing', activitySince: now }), agent('b')], now, 15);
    const person = world.people.get('a');
    expect(person?.room).toBe('/p/app');
    expect(person?.dest?.goal).toBe('desk');
  });

  it('lets a helper report back before going home', () => {
    const world = new World({ say: en.say, seed: 4 });
    const parent = agent('p', { activity: 'delegating' });
    let now = run(world, [parent], START, 1);
    const helper = agent('p/h', {
      kind: 'subagent',
      parentId: 'p',
      label: 'Check the tests',
      activitySince: now,
    });
    now = run(world, [parent, helper], now, 15);
    expect(world.people.get('p/h')?.briefed).toBe(true);
    run(world, [parent], now, 25);
    expect(world.people.has('p/h')).toBe(false);
    expect(world.log.some((entry) => entry.kind === 'left')).toBe(true);
  });

  it('closes an empty room after a while', () => {
    const world = new World({ say: en.say, seed: 5 });
    const now = run(world, [agent('a'), agent('b', { roomId: '/p/other' })], START, 1);
    run(world, [agent('a')], now, 70);
    expect(world.rooms.has('/p/other')).toBe(false);
    expect(world.rooms.has('/p/app')).toBe(true);
  });
});
