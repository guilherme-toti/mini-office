import { describe, expect, it } from 'vitest';
import { buildFloor, teamCapacity, teamTierFor, type TeamRequest } from './floor-plan.ts';
import { findPath, reachable } from './pathfinding.ts';
import { isWalkable, sameRect, tileKey, type FloorPlan, type Rect } from './types.ts';

const SHARED = new Set(['kitchen', 'lounge', 'games', 'meeting', 'terrace']);
const teams = (...tiers: number[]): TeamRequest[] =>
  tiers.map((tier, index) => ({ id: `team-${index}`, tier }));

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;
}

function assertSound(plan: FloorPlan): void {
  const fromDoor = reachable(plan, plan.door);
  for (const zone of plan.zones) {
    for (const desk of zone.desks) {
      expect(fromDoor.has(tileKey(desk.seat)), `${zone.id} seat ${tileKey(desk.seat)}`).toBe(true);
      expect(isWalkable(plan, desk.desk)).toBe(false);
    }
  }
  for (const spot of plan.spots) {
    expect(
      fromDoor.has(tileKey(spot.tile)),
      `${spot.zone} ${spot.kind} at ${tileKey(spot.tile)}`,
    ).toBe(true);
  }
  // Nothing seals off a pocket of floor.
  expect(fromDoor.size).toBe(plan.walkable.filter(Boolean).length);
  const tiles = new Set(plan.furniture.map((item) => tileKey(item)));
  expect(tiles.size).toBe(plan.furniture.length);
  for (const item of plan.furniture) {
    expect(
      item.x >= 0 && item.y >= 0 && item.x < plan.width && item.y < plan.depth,
      `${item.kind} in bounds`,
    ).toBe(true);
  }
  const teamZones = plan.zones.filter((zone) => zone.kind === 'team');
  for (let i = 0; i < teamZones.length; i += 1) {
    for (let j = i + 1; j < teamZones.length; j += 1) {
      const a = teamZones[i];
      const b = teamZones[j];
      if (a && b) expect(overlaps(a.rect, b.rect), `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

describe('team areas', () => {
  it('always have a desk for everyone', () => {
    for (const people of [1, 2, 3, 5, 9, 13, 20, 37, 50]) {
      expect(teamCapacity(teamTierFor(people))).toBeGreaterThanOrEqual(people);
    }
  });
});

describe('the office floor', () => {
  it('is walkable and connected for any mix of teams', () => {
    assertSound(buildFloor([]));
    assertSound(buildFloor(teams(0)));
    assertSound(buildFloor(teams(0, 2, 1, 4)));
    assertSound(buildFloor(teams(3, 3, 0, 5, 1, 2, 0, 0, 7)));
  });

  it('never moves the shared spaces when teams come and go', () => {
    const commons = (plan: FloorPlan) =>
      plan.furniture
        .filter((item) => SHARED.has(item.zone))
        .map((item) => `${item.kind}@${tileKey(item)}`);
    const small = commons(buildFloor(teams(0)));
    const big = commons(buildFloor(teams(5, 4, 3, 2)));
    // A deeper office only adds garden; everything that was there stays.
    for (const piece of small) expect(big).toContain(piece);
  });

  it('only moves teams placed after the one that grew', () => {
    const before = buildFloor(teams(1, 1, 1, 1));
    const after = buildFloor(teams(1, 3, 1, 1));
    const rect = (plan: FloorPlan, id: string) => plan.zones.find((zone) => zone.id === id)?.rect;
    const first = rect(before, 'team-0');
    const firstAfter = rect(after, 'team-0');
    expect(first && firstAfter && sameRect(first, firstAfter)).toBe(true);
  });

  it('walks only along the two isometric axes', () => {
    const plan = buildFloor(teams(2, 2));
    const target = plan.zones.at(-1)?.desks.at(-1)?.seat;
    if (!target) throw new Error('no desks');
    const path = findPath(plan, plan.door, target);
    expect(path).not.toBeNull();
    let previous = plan.door;
    for (const step of path ?? []) {
      expect(Math.abs(step.x - previous.x) + Math.abs(step.y - previous.y)).toBe(1);
      expect(isWalkable(plan, step)).toBe(true);
      previous = step;
    }
    expect(previous).toEqual(target);
  });

  it('stays close to square as it grows', () => {
    const plan = buildFloor(teams(2, 2, 2, 2, 2, 2, 2, 2, 2));
    expect(plan.width / plan.depth).toBeGreaterThan(0.6);
    expect(plan.width / plan.depth).toBeLessThan(2.2);
  });
});
