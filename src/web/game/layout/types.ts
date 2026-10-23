export interface Tile {
  x: number;
  y: number;
}

/**
 * Facing, in screen terms. +x (along the right wall) is south-east, +y (along the left wall) is
 * south-west.
 */
export type Dir = 'ne' | 'nw' | 'se' | 'sw';

export type FurnitureKind =
  | 'desk'
  | 'chair'
  | 'plant'
  | 'bigPlant'
  | 'tree'
  | 'flowers'
  | 'bookshelf'
  | 'printer'
  | 'server'
  | 'cabinet'
  | 'cooler'
  | 'coffee'
  | 'counter'
  | 'vending'
  | 'fridge'
  | 'arcade'
  | 'tv'
  | 'beanbag'
  | 'pingpong'
  | 'sofa'
  | 'coffeeTable'
  | 'meetingTable'
  | 'parasol'
  | 'bench'
  | 'partition'
  | 'lamp'
  | 'bin';

export interface Furniture {
  kind: FurnitureKind;
  x: number;
  y: number;
  /**
   * Cosmetic variant. Sofas: 0 left end, 1 middle, 2 right end. Partitions: a bitmask of the
   * neighbouring partitions (1 = -y, 2 = +x, 4 = +y, 8 = -x). Ping-pong: 0 or 1 for each half.
   */
  variant: number;
  /** Which way a seat faces, so its backrest ends up behind the sitter. */
  facing: Dir;
  blocks: boolean;
  /** Desks and chairs know which seat they belong to, so screens and owners line up. */
  deskIndex?: number;
  /** The zone this piece belongs to, so a rebuilding zone animates only its own furniture. */
  zone: string;
}

export interface Desk {
  index: number;
  desk: Tile;
  seat: Tile;
  facing: Dir;
}

export type SpotKind =
  | 'coffee'
  | 'cooler'
  | 'vending'
  | 'arcade'
  | 'tv'
  | 'pingpong'
  | 'sofa'
  | 'meeting'
  | 'parasol'
  | 'bench';

export interface Spot {
  kind: SpotKind;
  tile: Tile;
  facing: Dir;
  sit: boolean;
  zone: string;
}

export type WallDecorKind = 'window' | 'whiteboard' | 'poster' | 'clock' | 'board';

export interface WallDecor {
  wall: 'left' | 'right';
  /** Tile index along the wall. */
  at: number;
  kind: WallDecorKind;
  variant: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
}

export type ZoneKind = 'team' | 'kitchen' | 'lounge' | 'games' | 'meeting' | 'terrace';

export interface Zone {
  id: string;
  kind: ZoneKind;
  rect: Rect;
  /** Team zones only: their size step and desks. */
  tier: number;
  desks: Desk[];
}

/** Anything with a walkable grid: the whole floor, or a small test grid. */
export interface Grid {
  width: number;
  depth: number;
  walkable: boolean[];
}

/** The whole office: one floor with two back walls, shared spaces and a zone per team. */
export interface FloorPlan extends Grid {
  /** The tile just inside the main entrance on the left wall. */
  door: Tile;
  /** The left wall stops where the terrace begins, so the terrace reads as open air. */
  leftWallLength: number;
  zones: Zone[];
  furniture: Furniture[];
  spots: Spot[];
  wallDecor: WallDecor[];
  /** Floor style per tile, an index into FLOOR_STYLES. */
  floor: Uint8Array;
}

export function tileKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(grid: Pick<Grid, 'width' | 'depth'>, tile: Tile): boolean {
  return tile.x >= 0 && tile.y >= 0 && tile.x < grid.width && tile.y < grid.depth;
}

export function isWalkable(grid: Grid, tile: Tile): boolean {
  return inBounds(grid, tile) && grid.walkable[tile.y * grid.width + tile.x] === true;
}

export function inRect(rect: Rect, tile: { x: number; y: number }): boolean {
  return (
    tile.x >= rect.x && tile.y >= rect.y && tile.x < rect.x + rect.w && tile.y < rect.y + rect.d
  );
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.d === b.d;
}

/** Direction to face when stepping from one tile to a neighbour. */
export function stepDir(from: Tile, to: Tile, fallback: Dir): Dir {
  if (to.x > from.x) return 'se';
  if (to.x < from.x) return 'nw';
  if (to.y > from.y) return 'sw';
  if (to.y < from.y) return 'ne';
  return fallback;
}

/** Direction from one point to another, picking the dominant axis. */
export function lookDir(from: Tile, to: Tile, fallback: Dir): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'se' : 'nw';
  return dy > 0 ? 'sw' : 'ne';
}
