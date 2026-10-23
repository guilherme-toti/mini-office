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
  | 'sofa'
  | 'coffeeTable'
  | 'barTable'
  | 'lamp'
  | 'bin';

export interface Furniture {
  kind: FurnitureKind;
  x: number;
  y: number;
  /** Sofa pieces: 0 left end, 1 middle, 2 right end. Otherwise a cosmetic variant. */
  variant: number;
  blocks: boolean;
  /** Desks and chairs know which seat they belong to, so screens and owners line up. */
  deskIndex?: number;
}

export interface Desk {
  index: number;
  desk: Tile;
  seat: Tile;
  facing: Dir;
}

export type SpotKind = 'coffee' | 'cooler' | 'vending' | 'arcade' | 'sofa' | 'stand';

export interface Spot {
  kind: SpotKind;
  tile: Tile;
  facing: Dir;
  sit: boolean;
}

export type WallDecorKind = 'window' | 'whiteboard' | 'poster' | 'clock' | 'board';

export interface WallDecor {
  wall: 'left' | 'right';
  /** Tile index along the wall. */
  at: number;
  kind: WallDecorKind;
  variant: number;
}

export interface RoomLayout {
  kind: 'work' | 'lounge';
  tier: number;
  width: number;
  depth: number;
  /** The tile just inside the doorway on the left wall. */
  door: Tile;
  desks: Desk[];
  spots: Spot[];
  furniture: Furniture[];
  wallDecor: WallDecor[];
  walkable: boolean[];
}

export function tileKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(layout: Pick<RoomLayout, 'width' | 'depth'>, tile: Tile): boolean {
  return tile.x >= 0 && tile.y >= 0 && tile.x < layout.width && tile.y < layout.depth;
}

export function isWalkable(layout: RoomLayout, tile: Tile): boolean {
  return inBounds(layout, tile) && layout.walkable[tile.y * layout.width + tile.x] === true;
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
