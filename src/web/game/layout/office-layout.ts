import { HALF_H, HALF_W } from '../gfx/iso.ts';

/** Vertical size of the walls and floor slab, in native pixels. */
export const WALL_HEIGHT = 62;
export const WALL_THICKNESS = 4;
export const FLOOR_THICKNESS = 7;
/** Room name plate above the back corner. */
const LABEL_SPACE = 26;
const ROOM_PADDING = 6;
const GAP_X = 36;
const GAP_Y = 30;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The bounding box of a room in native pixels, relative to its origin (the back corner of the
 * floor).
 */
export function roomBounds(width: number, depth: number): Rect {
  const left = -depth * HALF_W - WALL_THICKNESS * 2 - ROOM_PADDING;
  const right = width * HALF_W + WALL_THICKNESS * 2 + ROOM_PADDING;
  const top = -WALL_HEIGHT - WALL_THICKNESS - LABEL_SPACE;
  const bottom = (width + depth) * HALF_H + FLOOR_THICKNESS + ROOM_PADDING;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface PackItem {
  id: string;
  bounds: Rect;
}

export interface Packing {
  origins: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/**
 * Lays rooms out in rows, in the order given (lounge first, then rooms by arrival). Every row
 * width that changes the result is tried, and the one that fills a screen of the given aspect
 * best wins, so the office reflows into the shape that shows everything biggest.
 */
export function packOffice(
  items: readonly PackItem[],
  aspect: number,
): Map<string, { x: number; y: number }> {
  if (items.length === 0) return new Map();
  let best: Packing | null = null;
  let bestScore = -1;
  const widths = items.map((item) => item.bounds.width + GAP_X);
  for (let start = 0; start < items.length; start += 1) {
    let rowWidth = 0;
    for (let end = start; end < items.length; end += 1) {
      rowWidth += widths[end] ?? 0;
      const packing = packRows(items, rowWidth - GAP_X);
      const score = Math.min(aspect / packing.width, 1 / packing.height);
      if (score > bestScore + 1e-9) {
        best = packing;
        bestScore = score;
      }
    }
  }
  return best?.origins ?? new Map<string, { x: number; y: number }>();
}

function packRows(items: readonly PackItem[], rowWidth: number): Packing {
  const origins = new Map<string, { x: number; y: number }>();

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  let widest = 0;
  let row: { item: PackItem; x: number }[] = [];

  const flush = () => {
    // Rooms in a row share a floor line, so short rooms sit level with tall ones.
    for (const { item, x } of row) {
      origins.set(item.id, {
        x: x - item.bounds.x,
        y: cursorY + rowHeight - item.bounds.height - item.bounds.y,
      });
    }
    widest = Math.max(widest, cursorX - GAP_X);
    cursorY += rowHeight + GAP_Y;
    cursorX = 0;
    rowHeight = 0;
    row = [];
  };

  for (const item of items) {
    if (row.length > 0 && cursorX + item.bounds.width > rowWidth) flush();
    row.push({ item, x: cursorX });
    cursorX += item.bounds.width + GAP_X;
    rowHeight = Math.max(rowHeight, item.bounds.height);
  }
  flush();
  return { origins, width: widest, height: cursorY - GAP_Y };
}
