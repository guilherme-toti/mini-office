import {
  FLOOR_THICKNESS,
  roomBounds,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from '../layout/office-layout.ts';
import type { RoomLayout, WallDecor } from '../layout/types.ts';
import { HALF_W, leftFaceQuad, offset, project, rightFaceQuad } from './iso.ts';
import { ART, OUTLINE, type RoomTheme } from './palette.ts';
import { hex, Pixmap, shade, type Color, type Point } from './pixmap.ts';

export interface RoomArt {
  floor: Pixmap;
  walls: Pixmap;
  /** Where the room origin (back corner of the floor) sits inside both pixmaps. */
  originX: number;
  originY: number;
}

const T = WALL_THICKNESS / HALF_W;
const DOOR_HEIGHT = 40;

/** One floor tile, with its top corner at (16, 0). Parity alternates checker colors. */
export function drawFloorTile(theme: RoomTheme, parity: number): Pixmap {
  const pm = new Pixmap(32, 16);
  const diamond = [
    { x: 16, y: 0 },
    { x: 32, y: 8 },
    { x: 16, y: 16 },
    { x: 0, y: 8 },
  ];
  const base = theme.floorStyle === 'checker' && parity % 2 === 1 ? theme.floorB : theme.floorA;
  pm.poly(diamond, base);
  if (theme.floorStyle === 'planks') {
    for (const v of [1 / 3, 2 / 3]) {
      const from = project(0, v);
      const to = project(1, v);
      for (let step = 0; step <= 32; step += 1) {
        const t = step / 32;
        pm.set(
          16 + from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
          shade(theme.floorA, 0.9),
        );
      }
    }
  } else if (theme.floorStyle === 'carpet') {
    for (let index = 0; index < 9; index += 1) {
      const x = ((index * 11 + parity * 5) % 24) + 4;
      const y = ((index * 7 + parity * 3) % 10) + 3;
      if (pm.isOpaqueAt(x, y)) pm.set(x, y, shade(theme.floorA, parity % 2 ? 1.06 : 0.94));
    }
  }
  // Light grid on the two back edges, the classic Habbo tile seam.
  const seam = shade(base, 0.9);
  for (let x = 0; x < 16; x += 1) {
    pm.set(x, 8 - Math.floor((x + 1) / 2), seam);
    pm.set(16 + x, Math.floor(x / 2), seam);
  }
  return pm;
}

export function bakeRoom(layout: RoomLayout, theme: RoomTheme): RoomArt {
  const bounds = roomBounds(layout.width, layout.depth);
  const originX = -bounds.x;
  const originY = -bounds.y;
  const floor = new Pixmap(bounds.width, bounds.height);
  const walls = new Pixmap(bounds.width, bounds.height);
  const toPm = (points: readonly Point[]) => offset(points, originX, originY);

  const tiles = [drawFloorTile(theme, 0), drawFloorTile(theme, 1)];
  for (let y = 0; y < layout.depth; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      const top = project(x, y);
      const tile = tiles[(x + y) % 2];
      if (tile) floor.blit(tile, originX + top.x - 16, originY + top.y);
    }
  }
  drawSlab(floor, layout, theme, toPm);
  drawWalls(walls, layout, theme, toPm);
  return { floor: floor.outline(OUTLINE), walls: walls.outline(OUTLINE), originX, originY };
}

function drawSlab(
  pm: Pixmap,
  layout: RoomLayout,
  theme: RoomTheme,
  toPm: (p: readonly Point[]) => Point[],
): void {
  const { width: w, depth: d } = layout;
  pm.poly(toPm(leftFaceQuad(0, w, d, -FLOOR_THICKNESS, 0)), theme.slab);
  pm.poly(toPm(rightFaceQuad(w, 0, d, -FLOOR_THICKNESS, 0)), shade(theme.slab, 0.78));
  pm.poly(toPm(leftFaceQuad(0, w, d, -1, 0)), shade(theme.slab, 1.2));
}

function drawWalls(
  pm: Pixmap,
  layout: RoomLayout,
  theme: RoomTheme,
  toPm: (p: readonly Point[]) => Point[],
): void {
  const { width: w, depth: d } = layout;
  const H = WALL_HEIGHT;
  const leftFace = shade(theme.wall, 0.86);
  const rightFace = theme.wall;
  const fill = (points: Point[], color: Color) => pm.poly(toPm(points), color);

  // Faces.
  fill(rightFaceQuad(0, 0, d, 0, H), leftFace);
  fill(leftFaceQuad(0, w, 0, 0, H), rightFace);
  // Baseboards.
  fill(rightFaceQuad(0, 0, d, 0, 3), theme.wallTrim);
  fill(leftFaceQuad(0, w, 0, 0, 3), theme.wallTrim);
  // Wall thickness: tops and the two open ends.
  const top = shade(theme.wallTrim, 1.25);
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
  fill(leftFaceQuad(-T, 0, d, -FLOOR_THICKNESS, H), shade(theme.wallTrim, 0.95));
  fill(rightFaceQuad(w, -T, 0, -FLOOR_THICKNESS, H), shade(theme.wallTrim, 0.75));

  for (const decor of layout.wallDecor) drawDecor(fill, decor, theme);

  // Door into the left wall.
  const door = layout.door.y;
  fill(rightFaceQuad(0, door + 0.04, door + 0.96, 0, DOOR_HEIGHT + 3), theme.wallTrim);
  fill(rightFaceQuad(0, door + 0.14, door + 0.86, 0, DOOR_HEIGHT), ART.door);
  fill(rightFaceQuad(0, door + 0.14, door + 0.3, 0, DOOR_HEIGHT), shade(ART.door, 1.5));
}

function drawDecor(
  fill: (points: Point[], color: Color) => void,
  decor: WallDecor,
  theme: RoomTheme,
): void {
  const quad =
    decor.wall === 'right'
      ? (a: number, b2: number, z0: number, z1: number) =>
          leftFaceQuad(decor.at + a, decor.at + b2, 0, z0, z1)
      : (a: number, b2: number, z0: number, z1: number) =>
          rightFaceQuad(0, decor.at + a, decor.at + b2, z0, z1);
  switch (decor.kind) {
    case 'window': {
      fill(quad(0.16, 0.84, 20, 50), ART.white);
      fill(quad(0.22, 0.78, 22, 48), ART.sky);
      fill(quad(0.25, 0.45, 38, 46), ART.skyLight);
      fill(quad(0.48, 0.52, 22, 48), ART.white);
      fill(quad(0.22, 0.78, 34, 35.5), ART.white);
      fill(quad(0.12, 0.88, 18, 20), shade(theme.wallTrim, 0.9));
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
