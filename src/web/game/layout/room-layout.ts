import { createRandom, hashString } from '../../../shared/random.ts';
import type { Desk, Furniture, FurnitureKind, RoomLayout, Spot, WallDecor } from './types.ts';

/** Desk grids a work room grows through: [columns, rows]. Each step keeps the room near-square. */
const WORK_TIERS: readonly (readonly [number, number])[] = [
  [2, 1],
  [2, 2],
  [3, 2],
  [3, 3],
  [4, 3],
  [4, 4],
  [5, 4],
  [5, 5],
  [6, 5],
  [6, 6],
];
const MAX_COLUMNS = 6;

/** Left lane (door side) and right lane widths, in tiles. */
const LEFT_LANE = 2;
const RIGHT_LANE = 2;
export const DOOR_ROW = 1;

function tierGrid(tier: number): readonly [number, number] {
  const fixed = WORK_TIERS[tier];
  if (fixed) return fixed;
  return [MAX_COLUMNS, MAX_COLUMNS + 1 + (tier - WORK_TIERS.length)];
}

export function workCapacity(tier: number): number {
  const [columns, rows] = tierGrid(tier);
  return columns * rows;
}

/** The smallest tier with a desk for everyone. */
export function workTierFor(people: number): number {
  let tier = 0;
  while (workCapacity(tier) < people) tier += 1;
  return tier;
}

class Builder {
  readonly furniture: Furniture[] = [];
  readonly blocked = new Set<string>();
  readonly width: number;
  readonly depth: number;

  constructor(width: number, depth: number) {
    this.width = width;
    this.depth = depth;
  }

  put(kind: FurnitureKind, x: number, y: number, options: Partial<Furniture> = {}): void {
    const blocks = options.blocks ?? true;
    this.furniture.push({ kind, x, y, variant: 0, ...options, blocks });
    if (blocks) this.blocked.add(`${x},${y}`);
  }

  walkable(): boolean[] {
    const grid: boolean[] = [];
    for (let y = 0; y < this.depth; y += 1) {
      for (let x = 0; x < this.width; x += 1) grid.push(!this.blocked.has(`${x},${y}`));
    }
    return grid;
  }
}

/**
 * A work room: rows of desks facing the back wall, a two-tile lane by the door, a lane on the
 * right, and decor only where it never cuts a path. Growing just adds columns and rows, so the
 * shape stays the same at every size.
 */
export function workRoomLayout(tier: number, roomId: string): RoomLayout {
  const [columns, rows] = tierGrid(tier);
  const width = LEFT_LANE + columns + RIGHT_LANE;
  const depth = 3 * rows + 2;
  const random = createRandom(hashString(roomId));
  const room = new Builder(width, depth);
  const desks: Desk[] = [];

  for (let row = 0; row < rows; row += 1) {
    const deskY = 1 + row * 3;
    for (let column = 0; column < columns; column += 1) {
      const x = LEFT_LANE + column;
      const index = desks.length;
      desks.push({ index, desk: { x, y: deskY }, seat: { x, y: deskY + 1 }, facing: 'ne' });
      room.put('desk', x, deskY, { deskIndex: index, variant: Math.floor(random() * 4) });
      room.put('chair', x, deskY + 1, { deskIndex: index, blocks: false });
    }
  }

  // Back row: shelves and machines against the right wall, behind the first row of desks.
  const backline: FurnitureKind[] = [
    'bookshelf',
    'printer',
    'plant',
    'bookshelf',
    'server',
    'cabinet',
  ];
  const shift = Math.floor(random() * backline.length);
  for (let x = LEFT_LANE; x < width - RIGHT_LANE; x += 1) {
    const kind = backline[(x + shift) % backline.length] ?? 'plant';
    room.put(kind, x, 0, { variant: Math.floor(random() * 3) });
  }
  room.put('bigPlant', 0, 0);
  room.put('bigPlant', width - 1, 0);

  // Right edge: something beside each desk row, leaving the inner lane free.
  const side: FurnitureKind[] = ['cooler', 'plant', 'cabinet', 'lamp'];
  for (let row = 0; row < rows; row += 1) {
    room.put(side[(row + shift) % side.length] ?? 'plant', width - 1, 1 + row * 3, {
      variant: row,
    });
  }

  // Front corners.
  room.put('plant', width - 1, depth - 1, { variant: 1 });
  room.put('bin', 0, depth - 1, { blocks: true });

  const wallDecor: WallDecor[] = [];
  for (let x = 1; x < width - 1; x += 2) {
    wallDecor.push({ wall: 'right', at: x, kind: 'window', variant: 0 });
  }
  wallDecor.push({ wall: 'left', at: DOOR_ROW + 2, kind: 'whiteboard', variant: 0 });
  if (depth >= 7)
    wallDecor.push({
      wall: 'left',
      at: depth - 2,
      kind: 'poster',
      variant: Math.floor(random() * 3),
    });
  wallDecor.push({ wall: 'left', at: 0, kind: 'clock', variant: 0 });

  return {
    kind: 'work',
    tier,
    width,
    depth,
    door: { x: 0, y: DOOR_ROW },
    desks,
    spots: [],
    furniture: room.furniture,
    wallDecor,
    walkable: room.walkable(),
  };
}

/** Lounge tiers: [modules across, modules deep]. Modules alternate sofa corners and bar tables. */
const LOUNGE_TIERS: readonly (readonly [number, number])[] = [
  [2, 1],
  [2, 2],
  [3, 2],
  [3, 3],
  [4, 3],
  [4, 4],
];
const MODULE_W = 4;
const MODULE_D = 3;

export function loungeTierFor(people: number): number {
  const wanted = Math.ceil(people * 0.8) + 2;
  let tier = 0;
  while (tier < LOUNGE_TIERS.length - 1 && loungeCapacity(tier) < wanted) tier += 1;
  return tier;
}

export function loungeCapacity(tier: number): number {
  return loungeLayout(tier).spots.length;
}

/** The break room: a kitchen line on the back wall, then sofa corners and bar tables. */
export function loungeLayout(tier: number): RoomLayout {
  const [across, deep] = LOUNGE_TIERS[Math.min(tier, LOUNGE_TIERS.length - 1)] ?? [2, 1];
  const width = LEFT_LANE + across * MODULE_W + 1;
  const depth = 2 + deep * MODULE_D + 1;
  const room = new Builder(width, depth);
  const spots: Spot[] = [];

  // Kitchen line on the back wall; each appliance has a spot right in front of it.
  const kitchen: [FurnitureKind, Spot['kind'] | null][] = [
    ['coffee', 'coffee'],
    ['counter', null],
    ['cooler', 'cooler'],
    ['fridge', null],
    ['vending', 'vending'],
    ['arcade', 'arcade'],
    ['coffee', 'coffee'],
    ['counter', null],
  ];
  for (let x = LEFT_LANE; x < width - 1; x += 1) {
    const [kind, spot] = kitchen[(x - LEFT_LANE) % kitchen.length] ?? ['counter', null];
    room.put(kind, x, 0, { variant: x });
    if (spot) spots.push({ kind: spot, tile: { x, y: 1 }, facing: 'ne', sit: false });
  }
  room.put('bigPlant', 0, 0);
  room.put('bigPlant', width - 1, 0);

  for (let row = 0; row < deep; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const mx = LEFT_LANE + column * MODULE_W;
      const my = 2 + row * MODULE_D;
      if ((row + column) % 2 === 0) {
        // Sofa corner: three seats facing a low table.
        for (let piece = 0; piece < 3; piece += 1) {
          room.put('sofa', mx + piece, my, { variant: piece, blocks: false });
          spots.push({ kind: 'sofa', tile: { x: mx + piece, y: my }, facing: 'sw', sit: true });
          room.put('coffeeTable', mx + piece, my + 1, { variant: piece });
        }
      } else {
        // Bar table with four people standing around it.
        const tx = mx + 1;
        const ty = my + 1;
        room.put('barTable', tx, ty);
        spots.push({ kind: 'stand', tile: { x: tx - 1, y: ty }, facing: 'se', sit: false });
        spots.push({ kind: 'stand', tile: { x: tx + 1, y: ty }, facing: 'nw', sit: false });
        spots.push({ kind: 'stand', tile: { x: tx, y: ty - 1 }, facing: 'sw', sit: false });
        spots.push({ kind: 'stand', tile: { x: tx, y: ty + 1 }, facing: 'ne', sit: false });
      }
    }
  }
  room.put('plant', width - 1, depth - 1, { variant: 2 });
  room.put('lamp', 0, depth - 1);

  const wallDecor: WallDecor[] = [];
  for (let x = 1; x < width - 1; x += 3)
    wallDecor.push({ wall: 'right', at: x, kind: 'window', variant: 1 });
  wallDecor.push({ wall: 'left', at: DOOR_ROW + 2, kind: 'board', variant: 0 });
  wallDecor.push({ wall: 'left', at: 0, kind: 'clock', variant: 0 });

  return {
    kind: 'lounge',
    tier,
    width,
    depth,
    door: { x: 0, y: DOOR_ROW },
    desks: [],
    spots,
    furniture: room.furniture,
    wallDecor,
    walkable: room.walkable(),
  };
}
