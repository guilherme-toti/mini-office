import { hashString } from '../../../shared/random.ts';
import { FLOOR, TEAM_FLOOR_COUNT } from '../gfx/palette.ts';
import type {
  Desk,
  Dir,
  FloorPlan,
  Furniture,
  FurnitureKind,
  Rect,
  Spot,
  SpotKind,
  WallDecor,
  Zone,
  ZoneKind,
} from './types.ts';

/*
 * The office, seen from above (x runs along the right wall, y along the left wall):
 *
 *   ┌ kitchen ─────┬ games ─┐ ┆ ┌ team ──┐  ┌ team ──┐
 *   │ lounge       │        │ ┆ │ desks  │  │ desks  │
 *   │ meeting room │ open   │ ┆ └────────┘  └────────┘
 *   ├─ glass ──────┴────────┤ ┆ ┌ team ──┐
 *   │ terrace (open air)    │ ┆ │ desks  │
 *
 * The shared spaces are a fixed block by the entrance, so growing teams never move them. Teams
 * sit in bands to the right of the main corridor; a team only moves when one before it grows.
 */

export const COMMONS_W = 16;
/** The glass line between the indoor commons and the terrace. */
const GLASS_Y = 15;
const TERRACE_Y = GLASS_Y + 1;
const MIN_DEPTH = 27;
const CORRIDOR = 2;
/** Teams start right after the main corridor. */
export const TEAMS_X = COMMONS_W + CORRIDOR;
const DOOR: { x: number; y: number } = { x: 0, y: 2 };

/** Desk grids a team area grows through: [desks per row, rows]. */
const TEAM_TIERS: readonly (readonly [number, number])[] = [
  [2, 1],
  [4, 1],
  [4, 2],
  [6, 2],
  [6, 3],
  [6, 4],
];
const MAX_DESKS_PER_ROW = 6;

function teamGrid(tier: number): readonly [number, number] {
  return TEAM_TIERS[tier] ?? [MAX_DESKS_PER_ROW, 4 + (tier - TEAM_TIERS.length + 1)];
}

export function teamCapacity(tier: number): number {
  const [columns, rows] = teamGrid(tier);
  return columns * rows;
}

/** The smallest team area with a desk for everyone. */
export function teamTierFor(people: number): number {
  let tier = 0;
  while (teamCapacity(tier) < people) tier += 1;
  return tier;
}

/** Desks come in pairs with a gap between pairs; aisles on both sides and a decor column. */
export function teamSize(tier: number): { w: number; d: number } {
  const [columns, rows] = teamGrid(tier);
  return { w: columns + Math.ceil(columns / 2) - 1 + 5, d: 4 * rows + 3 };
}

export interface TeamRequest {
  id: string;
  tier: number;
}

class Builder {
  readonly furniture: Furniture[] = [];
  readonly spots: Spot[] = [];
  readonly zones: Zone[] = [];
  private readonly taken = new Map<string, Furniture>();

  put(
    kind: FurnitureKind,
    x: number,
    y: number,
    zone: string,
    options: Partial<Furniture> = {},
  ): void {
    const key = `${x},${y}`;
    if (this.taken.has(key)) return;
    const item: Furniture = {
      kind,
      x,
      y,
      variant: 0,
      facing: 'sw',
      blocks: true,
      zone,
      ...options,
    };
    this.furniture.push(item);
    this.taken.set(key, item);
  }

  seat(
    kind: FurnitureKind,
    spot: SpotKind,
    x: number,
    y: number,
    facing: Dir,
    zone: string,
    variant = 0,
  ): void {
    this.put(kind, x, y, zone, { facing, blocks: false, variant });
    this.spot(spot, x, y, facing, zone, true);
  }

  spot(kind: SpotKind, x: number, y: number, facing: Dir, zone: string, sit = false): void {
    this.spots.push({ kind, tile: { x, y }, facing, sit, zone });
  }

  zone(id: string, kind: ZoneKind, rect: Rect, tier = 0, desks: Desk[] = []): void {
    this.zones.push({ id, kind, rect, tier, desks });
  }

  at(x: number, y: number): Furniture | undefined {
    return this.taken.get(`${x},${y}`);
  }
}

function paint(floor: Uint8Array, width: number, rect: Rect, style: number): void {
  for (let y = rect.y; y < rect.y + rect.d; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) floor[y * width + x] = style;
  }
}

function partitionLine(
  b: Builder,
  zone: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  gaps: ReadonlySet<string>,
): void {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  for (let x = from.x, y = from.y; ; x += dx, y += dy) {
    if (!gaps.has(`${x},${y}`)) b.put('partition', x, y, zone);
    if (x === to.x && y === to.y) break;
  }
}

function commons(b: Builder, depth: number): void {
  // Kitchen along the back wall; each appliance has a spot in front of it.
  b.zone('kitchen', 'kitchen', { x: 2, y: 0, w: 8, d: 3 });
  const kitchen: [FurnitureKind, SpotKind | null][] = [
    ['coffee', 'coffee'],
    ['counter', null],
    ['cooler', 'cooler'],
    ['fridge', null],
    ['vending', 'vending'],
    ['coffee', 'coffee'],
    ['counter', null],
  ];
  kitchen.forEach(([kind, spot], index) => {
    const x = 2 + index;
    b.put(kind, x, 0, 'kitchen', { variant: index });
    if (spot) b.spot(spot, x, 1, 'ne', 'kitchen');
  });
  b.put('bigPlant', 0, 0, 'kitchen');
  b.put('plant', 9, 0, 'kitchen', { variant: 1 });

  // Lounge: two sofas facing each other over a low table.
  b.zone('lounge', 'lounge', { x: 2, y: 3, w: 7, d: 5 });
  for (let piece = 0; piece < 3; piece += 1) {
    b.seat('sofa', 'sofa', 3 + piece, 4, 'sw', 'lounge', piece);
    b.put('coffeeTable', 3 + piece, 5, 'lounge', { variant: piece });
    b.seat('sofa', 'sofa', 3 + piece, 6, 'ne', 'lounge', piece);
  }
  b.put('lamp', 7, 4, 'lounge');
  b.put('plant', 7, 7, 'lounge', { variant: 2 });

  // Game corner: arcades and a TV on the back wall, bean bags, a ping-pong table.
  b.zone('games', 'games', { x: 10, y: 0, w: 6, d: 9 });
  b.put('arcade', 10, 0, 'games');
  b.put('arcade', 11, 0, 'games', { variant: 1 });
  b.spot('arcade', 10, 1, 'ne', 'games');
  b.spot('arcade', 11, 1, 'ne', 'games');
  b.put('tv', 13, 0, 'games');
  for (const x of [12, 13, 14]) b.seat('beanbag', 'tv', x, 2, 'ne', 'games', x);
  b.put('pingpong', 12, 5, 'games', { variant: 0 });
  b.put('pingpong', 13, 5, 'games', { variant: 1 });
  b.spot('pingpong', 11, 5, 'se', 'games');
  b.spot('pingpong', 14, 5, 'nw', 'games');
  b.put('bookshelf', 15, 0, 'games', { variant: 2 });
  b.put('bigPlant', 15, 8, 'games');

  // Meeting room: glass walls, a long table, chairs all around.
  const room: Rect = { x: 2, y: 9, w: 8, d: 6 };
  b.zone('meeting', 'meeting', room);
  const right = room.x + room.w - 1;
  const bottom = room.y + room.d - 1;
  const doors = new Set(['5,9', '6,9', `${right},11`, `${right},12`]);
  partitionLine(b, 'meeting', { x: room.x, y: room.y }, { x: right, y: room.y }, doors);
  partitionLine(b, 'meeting', { x: room.x, y: bottom }, { x: right, y: bottom }, doors);
  partitionLine(b, 'meeting', { x: room.x, y: room.y + 1 }, { x: room.x, y: bottom - 1 }, doors);
  partitionLine(b, 'meeting', { x: right, y: room.y + 1 }, { x: right, y: bottom - 1 }, doors);
  for (let x = 4; x <= 7; x += 1) {
    b.put('meetingTable', x, 11, 'meeting', { variant: x });
    b.put('meetingTable', x, 12, 'meeting', { variant: x + 1 });
    b.seat('chair', 'meeting', x, 10, 'sw', 'meeting', 1);
    b.seat('chair', 'meeting', x, 13, 'ne', 'meeting', 1);
  }
  b.seat('chair', 'meeting', 3, 11, 'se', 'meeting', 1);
  b.seat('chair', 'meeting', 3, 12, 'se', 'meeting', 1);

  // The open corner between the meeting room and the corridor.
  b.put('bigPlant', 15, 10, 'games');
  b.put('lamp', 15, 14, 'games');
  b.put('cabinet', 11, 14, 'games');
  b.put('printer', 12, 14, 'games');

  // Glass line onto the terrace, with doors by the lane and in the middle.
  partitionLine(
    b,
    'terrace',
    { x: 0, y: GLASS_Y },
    { x: COMMONS_W - 1, y: GLASS_Y },
    new Set(['0,15', '1,15', '11,15', '12,15']),
  );

  // Terrace: deck with parasol tables, benches, trees and flower beds.
  b.zone('terrace', 'terrace', { x: 0, y: TERRACE_Y, w: COMMONS_W, d: depth - TERRACE_Y });
  for (const cx of [5, 10]) {
    b.put('parasol', cx, 19, 'terrace');
    b.seat('chair', 'parasol', cx - 1, 19, 'se', 'terrace', 2);
    b.seat('chair', 'parasol', cx + 1, 19, 'nw', 'terrace', 2);
    b.seat('chair', 'parasol', cx, 18, 'sw', 'terrace', 2);
    b.seat('chair', 'parasol', cx, 20, 'ne', 'terrace', 2);
  }
  for (const x of [3, 4, 12, 13]) b.seat('bench', 'bench', x, 23, 'ne', 'terrace');
  for (let x = 6; x <= 9; x += 1) b.put('flowers', x, 23, 'terrace', { variant: x });
  for (const [x, y] of [
    [15, 17],
    [15, 22],
    [14, 25],
    [2, 25],
    [8, 26],
  ] as const) {
    if (y < depth) b.put('tree', x, y, 'terrace', { variant: x + y });
  }
  // Deeper offices get more garden, never moving what is already there.
  for (let y = 28; y < depth; y += 3) {
    b.put(y % 2 === 0 ? 'tree' : 'flowers', 3 + ((y * 7) % 10), y, 'terrace', { variant: y });
  }
}

/** One team area: partitions with doors, a decor row, and rows of desk pairs. */
function team(b: Builder, id: string, x0: number, y0: number, tier: number): Rect {
  const { w, d } = teamSize(tier);
  const [columns, rows] = teamGrid(tier);
  const rect: Rect = { x: x0, y: y0, w, d };
  const right = x0 + w - 1;
  const bottom = y0 + d - 1;
  const doors = new Set([
    `${x0},${y0 + 4}`,
    `${x0},${y0 + 5}`,
    `${right},${y0 + 4}`,
    `${right},${y0 + 5}`,
    `${x0 + Math.floor(w / 2) - 1},${bottom}`,
    `${x0 + Math.floor(w / 2)},${bottom}`,
  ]);
  // Against the back wall the wall itself closes the area.
  if (y0 > 0) partitionLine(b, id, { x: x0, y: y0 }, { x: right, y: y0 }, doors);
  partitionLine(b, id, { x: x0, y: bottom }, { x: right, y: bottom }, doors);
  partitionLine(b, id, { x: x0, y: y0 + 1 }, { x: x0, y: bottom - 1 }, doors);
  partitionLine(b, id, { x: right, y: y0 + 1 }, { x: right, y: bottom - 1 }, doors);

  const seed = hashString(id);
  const shelf: FurnitureKind[] = [
    'bookshelf',
    'printer',
    'plant',
    'server',
    'cabinet',
    'bookshelf',
  ];
  for (let x = x0 + 2; x <= right - 3; x += 1) {
    b.put(shelf[(x + seed) % shelf.length] ?? 'plant', x, y0 + 1, id, { variant: (x + seed) % 3 });
  }
  b.put('bigPlant', right - 1, y0 + 1, id);

  const desks: Desk[] = [];
  for (let row = 0; row < rows; row += 1) {
    const deskY = y0 + 2 + row * 4;
    for (let column = 0; column < columns; column += 1) {
      const x = x0 + 2 + column + Math.floor(column / 2);
      const index = desks.length;
      desks.push({ index, desk: { x, y: deskY }, seat: { x, y: deskY + 1 }, facing: 'ne' });
      b.put('desk', x, deskY, id, { deskIndex: index, variant: (index + seed) % 4 });
      b.put('chair', x, deskY + 1, id, {
        deskIndex: index,
        blocks: false,
        facing: 'ne',
        variant: seed % 4,
      });
    }
    const side: FurnitureKind[] = ['cooler', 'plant', 'cabinet', 'lamp'];
    b.put(side[(row + seed) % side.length] ?? 'plant', right - 1, deskY, id, { variant: row });
  }
  b.put('bin', x0 + 1, bottom - 1, id);
  b.zone(id, 'team', rect, tier, desks);
  return rect;
}

/**
 * Lays out the whole office for the given teams, in order. Teams fill bands of roughly
 * √n areas each, so the floor stays close to square however many teams there are.
 */
export function buildFloor(teams: readonly TeamRequest[]): FloorPlan {
  const perBand = Math.max(1, Math.ceil(Math.sqrt(teams.length)));
  const placed: { request: TeamRequest; x: number; y: number }[] = [];
  let y = 0;
  let widest = TEAMS_X;
  for (let start = 0; start < teams.length; start += perBand) {
    const band = teams.slice(start, start + perBand);
    let x = TEAMS_X;
    let bandDepth = 0;
    for (const request of band) {
      const size = teamSize(request.tier);
      placed.push({ request, x, y });
      x += size.w + CORRIDOR;
      bandDepth = Math.max(bandDepth, size.d);
    }
    widest = Math.max(widest, x);
    y += bandDepth + CORRIDOR;
  }
  const width = widest + (teams.length === 0 ? CORRIDOR : 0);
  const depth = Math.max(MIN_DEPTH, y + 1);

  const b = new Builder();
  const floor = new Uint8Array(width * depth).fill(FLOOR.corridor);
  commons(b, depth);
  for (const { request, x, y: top } of placed) {
    const rect = team(b, request.id, x, top, request.tier);
    paint(floor, width, rect, FLOOR.teams + (hashString(request.id) % TEAM_FLOOR_COUNT));
  }
  paint(floor, width, { x: 2, y: 0, w: 8, d: 3 }, FLOOR.kitchen);
  paint(floor, width, { x: 2, y: 3, w: 7, d: 5 }, FLOOR.lounge);
  paint(floor, width, { x: 10, y: 0, w: 6, d: 9 }, FLOOR.games);
  paint(floor, width, { x: 2, y: 9, w: 8, d: 6 }, FLOOR.meeting);
  paint(floor, width, { x: 0, y: TERRACE_Y, w: COMMONS_W, d: depth - TERRACE_Y }, FLOOR.grass);
  paint(floor, width, { x: 2, y: 17, w: 12, d: 5 }, FLOOR.deck);

  // Open floor gets the odd plant or lamp, never within a tile of an area or the main corridor.
  const zoned = (x: number, y: number) =>
    b.zones.some(
      (zone) =>
        x >= zone.rect.x - 1 &&
        y >= zone.rect.y - 1 &&
        x <= zone.rect.x + zone.rect.w &&
        y <= zone.rect.y + zone.rect.d,
    );
  const decor: FurnitureKind[] = ['bigPlant', 'lamp', 'plant', 'bigPlant'];
  for (let y = 3; y < depth - 2; y += 5) {
    for (let x = TEAMS_X + 2; x < width - 2; x += 6) {
      const clear = [-1, 0, 1].every((dy) => [-1, 0, 1].every((dx) => !zoned(x + dx, y + dy)));
      if (clear) b.put(decor[(x + y) % decor.length] ?? 'plant', x, y, 'decor', { variant: x + y });
    }
  }

  // Partitions join up with their neighbours.
  for (const item of b.furniture) {
    if (item.kind !== 'partition') continue;
    const near = (dx: number, dy: number) => b.at(item.x + dx, item.y + dy)?.kind === 'partition';
    item.variant =
      (near(0, -1) ? 1 : 0) | (near(1, 0) ? 2 : 0) | (near(0, 1) ? 4 : 0) | (near(-1, 0) ? 8 : 0);
  }

  const walkable = new Array<boolean>(width * depth).fill(true);
  for (const item of b.furniture) if (item.blocks) walkable[item.y * width + item.x] = false;

  const wallDecor: WallDecor[] = [];
  for (let x = 1; x < width - 1; x += 3) {
    if (x >= 10 && x <= 15) continue;
    wallDecor.push({ wall: 'right', at: x, kind: 'window', variant: 0 });
  }
  wallDecor.push({ wall: 'right', at: 12, kind: 'board', variant: 0 });
  wallDecor.push({ wall: 'left', at: 0, kind: 'clock', variant: 0 });
  wallDecor.push({ wall: 'left', at: 5, kind: 'poster', variant: 1 });
  wallDecor.push({ wall: 'left', at: 10, kind: 'whiteboard', variant: 0 });
  wallDecor.push({ wall: 'left', at: 13, kind: 'poster', variant: 2 });

  return {
    width,
    depth,
    door: { ...DOOR },
    leftWallLength: GLASS_Y + 1,
    zones: b.zones,
    furniture: b.furniture,
    spots: b.spots,
    wallDecor,
    walkable,
    floor,
  };
}
