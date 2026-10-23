import { shade, type Color, type Pixmap, type Point } from './pixmap.ts';

/** Habbo-style 2:1 isometric tiles, in native (unzoomed) pixels. */
export const TILE_W = 32;
export const TILE_H = 16;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

/**
 * Projects tile-space (u along the right wall, v along the left wall) and height z (px) to
 * screen pixels, relative to the back corner of the floor.
 */
export function project(u: number, v: number, z = 0): Point {
  return { x: (u - v) * HALF_W, y: (u + v) * HALF_H - z };
}

export interface BoxFaces {
  top: Color;
  left: Color;
  right: Color;
}

export interface Box {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  z0: number;
  z1: number;
}

/** A pixmap anchored so that tile point (0,0) on the floor lands at (anchorX, anchorY). */
export interface Canvas2 {
  pm: Pixmap;
  anchorX: number;
  anchorY: number;
}

export function at(canvas: Canvas2, u: number, v: number, z = 0): Point {
  const point = project(u, v, z);
  return { x: point.x + canvas.anchorX, y: point.y + canvas.anchorY };
}

/** The three visible faces of an axis-aligned box: top, left (+v side) and right (+u side). */
export function box(canvas: Canvas2, b: Box, faces: BoxFaces): void {
  const p = (u: number, v: number, z: number) => at(canvas, u, v, z);
  canvas.pm.poly(
    [p(b.u0, b.v1, b.z1), p(b.u1, b.v1, b.z1), p(b.u1, b.v1, b.z0), p(b.u0, b.v1, b.z0)],
    faces.left,
  );
  canvas.pm.poly(
    [p(b.u1, b.v0, b.z1), p(b.u1, b.v1, b.z1), p(b.u1, b.v1, b.z0), p(b.u1, b.v0, b.z0)],
    faces.right,
  );
  canvas.pm.poly(
    [p(b.u0, b.v0, b.z1), p(b.u1, b.v0, b.z1), p(b.u1, b.v1, b.z1), p(b.u0, b.v1, b.z1)],
    faces.top,
  );
}

/** A quad on the +v face of a box (the face that looks down-left), e.g. a monitor screen. */
export function leftFaceQuad(u0: number, u1: number, v: number, z0: number, z1: number): Point[] {
  return [project(u0, v, z1), project(u1, v, z1), project(u1, v, z0), project(u0, v, z0)];
}

/** A quad on the +u face of a box (the face that looks down-right). */
export function rightFaceQuad(u: number, v0: number, v1: number, z0: number, z1: number): Point[] {
  return [project(u, v0, z1), project(u, v1, z1), project(u, v1, z0), project(u, v0, z0)];
}

export function offset(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

/** Light comes from the top left: tops are brightest, right faces darkest. */
export function faces(base: Color): BoxFaces {
  return { top: shade(base, 1.14), left: base, right: shade(base, 0.8) };
}
