import { describe, expect, it } from 'vitest';
import { packOffice, roomBounds } from './office-layout.ts';
import { findPath, reachable } from './pathfinding.ts';
import {
  loungeLayout,
  loungeTierFor,
  workCapacity,
  workRoomLayout,
  workTierFor,
} from './room-layout.ts';
import { isWalkable, tileKey, type RoomLayout } from './types.ts';

function assertSound(layout: RoomLayout): void {
  const fromDoor = reachable(layout, layout.door);
  for (const desk of layout.desks) {
    expect(isWalkable(layout, desk.seat), `seat ${tileKey(desk.seat)}`).toBe(true);
    expect(fromDoor.has(tileKey(desk.seat)), `seat ${tileKey(desk.seat)} reachable`).toBe(true);
    expect(isWalkable(layout, desk.desk)).toBe(false);
  }
  for (const spot of layout.spots) {
    expect(fromDoor.has(tileKey(spot.tile)), `spot ${tileKey(spot.tile)} reachable`).toBe(true);
  }
  // Decor never seals off part of the floor.
  const walkable = layout.walkable.filter(Boolean).length;
  expect(fromDoor.size).toBe(walkable);
  const occupied = new Set(layout.furniture.map((item) => tileKey(item)));
  expect(occupied.size).toBe(layout.furniture.length);
}

describe('work rooms', () => {
  it('always have a desk for everyone', () => {
    for (const people of [1, 2, 3, 5, 9, 13, 20, 37, 50]) {
      const tier = workTierFor(people);
      expect(workCapacity(tier)).toBeGreaterThanOrEqual(people);
      expect(workRoomLayout(tier, 'room').desks).toHaveLength(workCapacity(tier));
    }
  });

  it('stay walkable and connected at every size', () => {
    for (let tier = 0; tier < 14; tier += 1) assertSound(workRoomLayout(tier, `room-${tier}`));
  });

  it('only grow when they get bigger', () => {
    let previous = workRoomLayout(0, 'r');
    for (let tier = 1; tier < 12; tier += 1) {
      const next = workRoomLayout(tier, 'r');
      expect(next.width).toBeGreaterThanOrEqual(previous.width);
      expect(next.depth).toBeGreaterThanOrEqual(previous.depth);
      previous = next;
    }
  });
});

describe('lounge', () => {
  it('stays sound and scales with the office', () => {
    for (let tier = 0; tier < 6; tier += 1) assertSound(loungeLayout(tier));
    expect(loungeTierFor(40)).toBeGreaterThan(loungeTierFor(2));
  });
});

describe('pathfinding', () => {
  it('walks only along the two isometric axes', () => {
    const layout = workRoomLayout(3, 'r');
    const target = layout.desks.at(-1)?.seat;
    if (!target) throw new Error('no desks');
    const path = findPath(layout, layout.door, target);
    expect(path).not.toBeNull();
    let previous = layout.door;
    for (const step of path ?? []) {
      expect(Math.abs(step.x - previous.x) + Math.abs(step.y - previous.y)).toBe(1);
      expect(isWalkable(layout, step)).toBe(true);
      previous = step;
    }
    expect(previous).toEqual(target);
  });

  it('returns null for blocked targets', () => {
    const layout = workRoomLayout(0, 'r');
    const desk = layout.desks[0]?.desk;
    if (!desk) throw new Error('no desk');
    expect(findPath(layout, layout.door, desk)).toBeNull();
  });
});

describe('office packing', () => {
  const rect = (
    a: { x: number; y: number; width: number; height: number },
    origin: { x: number; y: number },
  ) => ({
    left: origin.x + a.x,
    top: origin.y + a.y,
    right: origin.x + a.x + a.width,
    bottom: origin.y + a.y + a.height,
  });

  it('never overlaps rooms, whatever the screen shape', () => {
    const sizes = [
      [11, 6],
      [6, 5],
      [7, 11],
      [6, 8],
      [8, 8],
      [6, 5],
    ] as const;
    const items = sizes.map(([w, d], index) => ({ id: `r${index}`, bounds: roomBounds(w, d) }));
    for (const aspect of [0.5, 1, 1.6, 3]) {
      const origins = packOffice(items, aspect);
      const rects = items.map((item) => {
        const origin = origins.get(item.id);
        if (!origin) throw new Error('missing origin');
        return rect(item.bounds, origin);
      });
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          if (!a || !b) continue;
          const overlap =
            a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          expect(overlap, `r${i} overlaps r${j} at aspect ${aspect}`).toBe(false);
        }
      }
    }
  });

  it('goes wide on wide screens and tall on tall ones', () => {
    const items = Array.from({ length: 4 }, (_, index) => ({
      id: `r${index}`,
      bounds: roomBounds(6, 5),
    }));
    const xs = (aspect: number) =>
      new Set([...packOffice(items, aspect).values()].map((origin) => origin.x)).size;
    expect(xs(4)).toBe(4);
    expect(xs(0.4)).toBe(1);
  });
});
