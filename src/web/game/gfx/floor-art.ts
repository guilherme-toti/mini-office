import type { FloorPlan, WallDecor } from '../layout/types.ts';
import { HALF_H, HALF_W, leftFaceQuad, offset, project, rightFaceQuad } from './iso.ts';
import { ART, FLOOR_STYLES, OUTLINE, WALLS, type FloorStyle } from './palette.ts';
import { hex, Pixmap, shade, type Color, type Point } from './pixmap.ts';

/** Vertical size of the walls and floor slab, in native pixels. */
export const WALL_HEIGHT = 62;
const WALL_THICKNESS = 4;
const FLOOR_THICKNESS = 7;
const PADDING = 6;
const T = WALL_THICKNESS / HALF_W;
const DOOR_HEIGHT = 40;

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The floor's bounding box in native pixels, relative to the back corner of the floor. */
export function floorBounds(width: number, depth: number): PixelRect {
  const left = -depth * HALF_W - WALL_THICKNESS * 2 - PADDING;
  const right = width * HALF_W + WALL_THICKNESS * 2 + PADDING;
  const top = -WALL_HEIGHT - WALL_THICKNESS - PADDING;
  const bottom = (width + depth) * HALF_H + FLOOR_THICKNESS + PADDING;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface FloorArt {
  floor: Pixmap;
  walls: Pixmap;
  /** Where the floor's back corner sits inside both pixmaps. */
  originX: number;
  originY: number;
}

/** One floor tile, with its top corner at (16, 0). Parity alternates checker colors. */
export function drawFloorTile(style: FloorStyle, parity: number, seed = 0): Pixmap {
  const pm = new Pixmap(32, 16);
  const diamond = [
    { x: 16, y: 0 },
    { x: 32, y: 8 },
    { x: 16, y: 16 },
    { x: 0, y: 8 },
  ];
  const base = style.pattern === 'checker' && parity % 2 === 1 ? style.b : style.a;
  pm.poly(diamond, base);
  if (style.pattern === 'planks') {
    for (const v of [1 / 3, 2 / 3]) {
      const from = project(0, v);
      const to = project(1, v);
      for (let step = 0; step <= 32; step += 1) {
        const t = step / 32;
        pm.set(
          16 + from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
          shade(style.a, 0.9),
        );
      }
    }
  } else if (style.pattern === 'carpet' || style.pattern === 'grass') {
    const grass = style.pattern === 'grass';
    const count = grass ? 16 : 9;
    for (let index = 0; index < count; index += 1) {
      const x = ((index * 11 + parity * 5 + seed * 3) % 24) + 4;
      const y = ((index * 7 + parity * 3 + seed) % 10) + 3;
      if (!pm.isOpaqueAt(x, y)) continue;
      const tint = grass ? (index % 3 === 0 ? 1.15 : 0.85) : parity % 2 ? 1.06 : 0.94;
      pm.set(x, y, shade(style.a, tint));
      if (grass && index % 3 !== 0) pm.set(x, y - 1, shade(style.a, tint));
    }
    // The odd daisy in the lawn.
    if (grass && seed % 7 === 0) pm.set(12 + (seed % 9), 7, ART.white);
  }
  // Light grid on the two back edges, the classic Habbo tile seam.
  const seam = shade(base, style.pattern === 'grass' ? 0.95 : 0.9);
  for (let x = 0; x < 16; x += 1) {
    pm.set(x, 8 - Math.floor((x + 1) / 2), seam);
    pm.set(16 + x, Math.floor(x / 2), seam);
  }
  return pm;
}

/** A small set of tile pixmaps per style, so a big floor bakes from a handful of sprites. */
export function tileVariant(style: number, x: number, y: number): { parity: number; seed: number } {
  return { parity: (x + y) % 2, seed: (x * 7 + y * 13 + style) % 8 };
}

/**
 * Bakes the whole floor and its walls. Tiles for which `skip` returns true are left out so
 * the renderer can animate them, e.g. a team area being rebuilt.
 */
export function bakeFloor(
  plan: FloorPlan,
  skip: (x: number, y: number) => boolean = () => false,
): FloorArt {
  const bounds = floorBounds(plan.width, plan.depth);
  const originX = -bounds.x;
  const originY = -bounds.y;
  const floor = new Pixmap(bounds.width, bounds.height);
  const walls = new Pixmap(bounds.width, bounds.height);
  const toPm = (points: readonly Point[]) => offset(points, originX, originY);

  const tiles = new Map<string, Pixmap>();
  for (let y = 0; y < plan.depth; y += 1) {
    for (let x = 0; x < plan.width; x += 1) {
      if (skip(x, y)) continue;
      const styleIndex = plan.floor[y * plan.width + x] ?? 0;
      const style = FLOOR_STYLES[styleIndex] ?? FLOOR_STYLES[0];
      if (!style) continue;
      const { parity, seed } = tileVariant(styleIndex, x, y);
      const key = `${styleIndex}|${parity}|${seed}`;
      let tile = tiles.get(key);
      if (!tile) {
        tile = drawFloorTile(style, parity, seed);
        tiles.set(key, tile);
      }
      const top = project(x, y);
      floor.blit(tile, originX + top.x - 16, originY + top.y);
    }
  }
  drawSlab(floor, plan, toPm);
  drawWalls(walls, plan, toPm);
  return { floor: floor.outline(OUTLINE), walls: walls.outline(OUTLINE), originX, originY };
}

function drawSlab(pm: Pixmap, plan: FloorPlan, toPm: (p: readonly Point[]) => Point[]): void {
  const { width: w, depth: d } = plan;
  pm.poly(toPm(leftFaceQuad(0, w, d, -FLOOR_THICKNESS, 0)), WALLS.slab);
  pm.poly(toPm(rightFaceQuad(w, 0, d, -FLOOR_THICKNESS, 0)), shade(WALLS.slab, 0.78));
  pm.poly(toPm(leftFaceQuad(0, w, d, -1, 0)), shade(WALLS.slab, 1.2));
}

function drawWalls(pm: Pixmap, plan: FloorPlan, toPm: (p: readonly Point[]) => Point[]): void {
  const w = plan.width;
  const d = plan.leftWallLength;
  const H = WALL_HEIGHT;
  const fill = (points: Point[], color: Color) => pm.poly(toPm(points), color);

  fill(rightFaceQuad(0, 0, d, 0, H), shade(WALLS.wall, 0.86));
  fill(leftFaceQuad(0, w, 0, 0, H), WALLS.wall);
  fill(rightFaceQuad(0, 0, d, 0, 3), WALLS.trim);
  fill(leftFaceQuad(0, w, 0, 0, 3), WALLS.trim);
  const top = shade(WALLS.trim, 1.25);
  fill(
    [
      project(-T, -T, H),
      project(w, -T, H),
      project(w, 0, H),
      project(0, 0, H),
      project(0, d, H),
      project(-T, d, H),
    ],
    top,
  );
  // The left wall ends where the terrace opens up; its end face shows there.
  fill(leftFaceQuad(-T, 0, d, 0, H), shade(WALLS.trim, 0.95));
  fill(rightFaceQuad(w, -T, 0, -FLOOR_THICKNESS, H), shade(WALLS.trim, 0.75));

  for (const decor of plan.wallDecor) drawDecor(fill, decor);

  const door = plan.door.y;
  fill(rightFaceQuad(0, door + 0.04, door + 0.96, 0, DOOR_HEIGHT + 3), WALLS.trim);
  fill(rightFaceQuad(0, door + 0.14, door + 0.86, 0, DOOR_HEIGHT), ART.door);
  fill(rightFaceQuad(0, door + 0.14, door + 0.3, 0, DOOR_HEIGHT), shade(ART.door, 1.5));
}

function drawDecor(fill: (points: Point[], color: Color) => void, decor: WallDecor): void {
  const quad =
    decor.wall === 'right'
      ? (a: number, b: number, z0: number, z1: number) =>
          leftFaceQuad(decor.at + a, decor.at + b, 0, z0, z1)
      : (a: number, b: number, z0: number, z1: number) =>
          rightFaceQuad(0, decor.at + a, decor.at + b, z0, z1);
  switch (decor.kind) {
    case 'window': {
      fill(quad(0.16, 0.84, 20, 50), ART.white);
      fill(quad(0.22, 0.78, 22, 48), ART.sky);
      fill(quad(0.25, 0.45, 38, 46), ART.skyLight);
      fill(quad(0.48, 0.52, 22, 48), ART.white);
      fill(quad(0.22, 0.78, 34, 35.5), ART.white);
      fill(quad(0.12, 0.88, 18, 20), shade(WALLS.trim, 0.9));
      break;
    }
    case 'whiteboard': {
      fill(quad(0.05, 0.95, 22, 46), ART.metal);
      fill(quad(0.1, 0.9, 24, 44), ART.white);
      fill(quad(0.18, 0.5, 38, 39.5), hex('#4c8fe0'));
      fill(quad(0.18, 0.7, 33, 34.5), hex('#e45b5b'));
      fill(quad(0.18, 0.4, 28, 29.5), hex('#3fb6a8'));
      fill(quad(0.55, 0.82, 27, 37), hex('#ffe58a'));
      break;
    }
    case 'poster': {
      const colors = [hex('#f0a63c'), hex('#7a6cf0'), hex('#3fb6a8')];
      fill(quad(0.2, 0.8, 22, 46), colors[decor.variant % colors.length] ?? ART.yellow);
      fill(quad(0.32, 0.68, 30, 40), ART.white);
      fill(quad(0.42, 0.58, 33, 37), colors[(decor.variant + 1) % colors.length] ?? ART.red);
      break;
    }
    case 'clock': {
      fill(quad(0.3, 0.7, 44, 54), ART.black);
      fill(quad(0.34, 0.66, 45.5, 52.5), ART.white);
      fill(quad(0.49, 0.52, 49, 52), ART.black);
      fill(quad(0.49, 0.62, 48.5, 49.5), ART.black);
      break;
    }
    case 'board': {
      fill(quad(0.05, 0.95, 22, 44), ART.woodDark);
      fill(quad(0.1, 0.9, 24, 42), hex('#d9a066'));
      fill(quad(0.15, 0.35, 32, 39), hex('#ffe58a'));
      fill(quad(0.42, 0.62, 28, 36), hex('#9fe0ff'));
      fill(quad(0.68, 0.86, 33, 40), hex('#ffb3c7'));
      break;
    }
  }
}
