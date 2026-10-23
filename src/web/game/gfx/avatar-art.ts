import type { Look } from '../sim/persona.ts';
import { hex, Pixmap, shade, type Color } from './pixmap.ts';
import { OUTLINE } from './palette.ts';

export const AVATAR_W = 26;
export const AVATAR_H = 50;
/** Where the feet touch the floor, inside the sprite. */
export const AVATAR_ANCHOR_X = 13;
export const AVATAR_ANCHOR_Y = 46;
/** Top of the head when standing, measured up from the feet. */
export const AVATAR_HEAD_TOP = 40;

/** front = facing south-east (we see the face), back = facing north-east. Mirrors give the rest. */
export type AvatarView = 'front' | 'back';
export type AvatarPose = 'stand' | 'walk' | 'sit' | 'type' | 'drink' | 'wave' | 'sleep';

export interface AvatarFrame {
  look: Look;
  view: AvatarView;
  pose: AvatarPose;
  frame: number;
  badge: boolean;
}

interface Colors {
  skin: Color;
  skinShade: Color;
  hair: Color;
  hairShade: Color;
  top: Color;
  topShade: Color;
  bottom: Color;
  bottomShade: Color;
  shoes: Color;
  eye: Color;
  white: Color;
}

function colorsOf(look: Look): Colors {
  const skin = hex(look.skin);
  const hair = hex(look.hair);
  const top = hex(look.top);
  const bottom = hex(look.bottom);
  return {
    skin,
    skinShade: shade(skin, 0.84),
    hair,
    hairShade: shade(hair, 0.78),
    top,
    topShade: shade(top, 0.82),
    bottom,
    bottomShade: shade(bottom, 0.82),
    shoes: hex(look.shoes),
    eye: hex('#241c2c'),
    white: hex('#ffffff'),
  };
}

/** Draws one avatar frame. The body is built bottom-up so later parts overlap earlier ones. */
export function drawAvatar({ look, view, pose, frame, badge }: AvatarFrame): Pixmap {
  const pm = new Pixmap(AVATAR_W, AVATAR_H);
  const c = colorsOf(look);
  const r = (x: number, y: number, w: number, h: number, color: Color) =>
    pm.rect(x, y, w, h, color);
  const seated = pose === 'sit' || pose === 'type' || pose === 'sleep';
  /** Seated bodies drop onto the seat. */
  const dy = seated ? 4 : 0;
  const step = pose === 'walk' ? ([0, 1, 0, -1][frame % 4] ?? 0) : 0;

  // Legs and shoes.
  if (seated) {
    if (view === 'front') {
      r(8, 37, 12, 4, c.bottom);
      r(8, 40, 12, 1, c.bottomShade);
      r(16, 41, 4, 3, c.bottomShade);
      r(16, 44, 5, 2, c.shoes);
    } else {
      r(8, 37, 10, 3, c.bottom);
      r(13, 37, 1, 3, c.bottomShade);
    }
  } else if (look.outfit === 'dress') {
    r(9 - step, 38, 2, 5, c.skin);
    r(14 + step, 38, 2, 5, c.skinShade);
    r(8 - step, 43, 4, 3, c.shoes);
    r(13 + step, 43, 4, 3, shade(c.shoes, 0.85));
  } else {
    r(8 - step, 33, 4, 10, c.bottom);
    r(13 + step, 33, 4, 10, c.bottomShade);
    r(12, 33, 1, 3, c.bottom);
    const toe = view === 'front' ? 1 : 0;
    r(8 - step, 43, 4 + toe, 3, c.shoes);
    r(13 + step, 43, 4 + toe, 3, shade(c.shoes, 0.85));
  }

  // Torso.
  const torsoTop = 21 + dy;
  r(7, torsoTop, 11, 12, c.top);
  r(8, torsoTop - 1, 9, 1, c.top);
  if (view === 'front') r(16, torsoTop, 2, 12, c.topShade);
  r(7, torsoTop + 11, 11, 1, c.topShade);
  if (look.outfit === 'dress' && !seated) {
    r(6, 33, 13, 5, c.top);
    r(6, 37, 13, 1, c.topShade);
    r(16, 33, 3, 4, c.topShade);
  }
  drawOutfit(pm, look, c, view, torsoTop, seated);

  // Arms.
  drawArms(pm, c, view, pose, frame, torsoTop);

  // Neck and head.
  const headTop = 7 + dy + (pose === 'sleep' ? 2 : 0);
  const headX = pose === 'sleep' ? 8 : 7;
  r(11, torsoTop - 2, 4, 2, c.skinShade);
  r(headX, headTop, 12, 12, c.skin);
  for (const [x, y] of [
    [0, 0],
    [11, 0],
    [0, 11],
    [11, 11],
  ] as const) {
    pm.pixels[(headTop + y) * AVATAR_W + headX + x] = 0;
  }
  if (view === 'front') {
    r(headX + 1, headTop + 5, 2, 3, c.skinShade);
    const blink = pose === 'sleep';
    r(headX + 6, headTop + 6, 1, blink ? 1 : 2, c.eye);
    r(headX + 9, headTop + 6, 1, blink ? 1 : 2, c.eye);
    r(headX + 7, headTop + 9, 2, 1, shade(c.skin, 0.72));
    r(headX + 10, headTop + 8, 1, 1, shade(hex('#ff8f8f'), 1));
  }
  drawHair(pm, look, c, view, headX, headTop);
  drawAccessory(pm, look, view, headX, headTop);
  if (badge && view === 'front') {
    r(11, torsoTop, 1, 4, hex('#3d5ad8'));
    r(14, torsoTop, 1, 4, hex('#3d5ad8'));
    r(11, torsoTop + 4, 4, 4, hex('#ffd447'));
    r(12, torsoTop + 5, 2, 1, c.white);
  }

  return pm.outline(OUTLINE);
}

function drawOutfit(
  pm: Pixmap,
  look: Look,
  c: Colors,
  view: AvatarView,
  top: number,
  seated: boolean,
): void {
  const r = (x: number, y: number, w: number, h: number, color: Color) =>
    pm.rect(x, y, w, h, color);
  switch (look.outfit) {
    case 'tee':
      if (view === 'front') r(11, top, 3, 1, c.skin);
      break;
    case 'stripes':
      for (const y of [2, 5, 8]) r(7, top + y, 11, 1, shade(c.top, 1.4));
      break;
    case 'collar':
      if (view === 'front') {
        r(9, top - 1, 7, 2, c.white);
        r(12, top + 1, 1, 1, c.white);
        for (let y = 3; y < 11; y += 3) r(12, top + y, 1, 1, c.topShade);
      } else {
        r(9, top - 1, 7, 1, c.white);
      }
      break;
    case 'hoodie':
      if (view === 'front') {
        r(7, top - 2, 3, 3, c.topShade);
        r(11, top + 1, 1, 4, c.white);
        r(14, top + 1, 1, 4, c.white);
        r(9, top + 7, 7, 3, c.topShade);
      } else {
        r(8, top - 1, 9, 4, c.topShade);
      }
      break;
    case 'dress':
      if (!seated) r(7, top + 10, 11, 1, shade(c.top, 1.25));
      break;
  }
}

function drawArms(
  pm: Pixmap,
  c: Colors,
  view: AvatarView,
  pose: AvatarPose,
  frame: number,
  top: number,
): void {
  const r = (x: number, y: number, w: number, h: number, color: Color) =>
    pm.rect(x, y, w, h, color);
  const swing = pose === 'walk' ? ([0, -1, 0, 1][frame % 4] ?? 0) : 0;
  const arm = (x: number, y: number, length: number, sleeve: Color) => {
    r(x, y, 2, 4, sleeve);
    r(x, y + 4, 2, length - 4, c.skin);
  };

  // Back arm (far side) first.
  if (pose === 'type' || pose === 'sleep') {
    const lift = pose === 'type' ? frame % 2 : 0;
    arm(5, top + 1 + lift, 7, c.topShade);
    arm(18, top + 1 + (1 - lift), 7, c.topShade);
    return;
  }
  arm(5, top + 1 + swing, 10, c.topShade);

  // Front arm.
  if (pose === 'drink' && view === 'front') {
    r(18, top + 1, 2, 3, c.top);
    r(17, top - 4, 2, 5, c.skin);
    r(16, top - 6, 2, 2, c.skin);
    r(17, top - 9, 3, 4, c.white);
    r(17, top - 9, 3, 1, hex('#8a5a3c'));
    return;
  }
  if (pose === 'wave') {
    const wiggle = frame % 2;
    r(18, top, 2, 3, c.top);
    r(19 + wiggle, top - 9, 2, 9, c.skin);
    r(19 + wiggle, top - 11, 3, 3, c.skin);
    return;
  }
  arm(18, top + 1 - swing, 10, view === 'front' ? c.top : c.topShade);
}

type Paint = (x: number, y: number, w: number, h: number, color: Color) => void;

/** Two-pixel tufts: single-pixel spikes turn into a dotted crown once outlined. */
function spikes(r: Paint, color: Color): void {
  for (let x = 0; x < 12; x += 3) r(x, x % 2 === 0 ? -4 : -3, 2, 4, color);
}

function curls(r: Paint, color: Color): void {
  for (let x = -2; x < 14; x += 3) r(x, -5, 2, 2, color);
}

function drawHair(
  pm: Pixmap,
  look: Look,
  c: Colors,
  view: AvatarView,
  hx: number,
  ht: number,
): void {
  const r = (x: number, y: number, w: number, h: number, color: Color) =>
    pm.rect(hx + x, ht + y, w, h, color);
  const hair = c.hair;
  const dark = c.hairShade;
  const style = look.hairStyle;

  if (style === 'bald') {
    r(3, 1, 2, 1, shade(c.skin, 1.18));
    return;
  }
  if (view === 'back') {
    const base = style === 'buzz' ? 9 : 10;
    r(0, -1, 12, base, hair);
    r(1, -2, 10, 1, hair);
    r(0, base - 2, 12, 1, dark);
    if (style === 'long') {
      r(-1, 2, 14, 18, hair);
      r(-1, 18, 14, 2, dark);
    }
    if (style === 'bob') r(-1, 2, 14, 11, hair);
    if (style === 'curly') {
      r(-2, -3, 16, 13, hair);
      curls(r, hair);
    }
    if (style === 'bun') r(3, -6, 6, 5, hair);
    if (style === 'ponytail') r(4, 9, 4, 9, hair);
    if (style === 'spiky') spikes(r, hair);
    return;
  }

  // Front (face looks right): hair on top and down the back of the head on the left.
  if (style === 'buzz') {
    r(0, 0, 12, 3, shade(hair, 1.1));
    r(0, 3, 2, 3, shade(hair, 1.1));
    return;
  }
  r(1, -1, 10, 1, hair);
  r(0, 0, 12, 4, hair);
  r(0, 4, 3, 4, hair);
  r(8, 4, 4, 1, hair);
  r(0, 3, 12, 1, dark);
  switch (style) {
    case 'spiky':
      spikes(r, hair);
      break;
    case 'long':
      r(-2, 4, 5, 16, hair);
      r(-2, 18, 5, 2, dark);
      r(10, 4, 2, 7, hair);
      break;
    case 'bob':
      r(-1, 4, 4, 8, hair);
      r(10, 4, 3, 7, hair);
      r(-1, 11, 4, 1, dark);
      break;
    case 'bun':
      r(-2, -5, 6, 5, hair);
      r(-1, -6, 4, 1, hair);
      break;
    case 'ponytail':
      r(-4, 3, 4, 2, dark);
      r(-5, 5, 4, 11, hair);
      break;
    case 'curly':
      r(-2, -3, 16, 7, hair);
      r(-2, 4, 5, 6, hair);
      curls(r, hair);
      r(12, 2, 2, 4, hair);
      break;
    default:
      break;
  }
}

function drawAccessory(pm: Pixmap, look: Look, view: AvatarView, hx: number, ht: number): void {
  const r = (x: number, y: number, w: number, h: number, color: Color) =>
    pm.rect(hx + x, ht + y, w, h, color);
  if (look.accessory === 'glasses' && view === 'front') {
    const frameColor = hex('#2b2b3a');
    r(5, 5, 7, 1, frameColor);
    r(5, 6, 3, 2, frameColor);
    r(9, 6, 3, 2, frameColor);
    r(6, 6, 1, 1, hex('#bfe6ff'));
    r(10, 6, 1, 1, hex('#bfe6ff'));
  }
  if (look.accessory === 'headphones') {
    const band = hex('#2b2b3a');
    const cup = hex('#e45b5b');
    r(1, -2, 10, 1, band);
    if (view === 'front') {
      r(0, -1, 1, 4, band);
      r(0, 4, 3, 4, cup);
    } else {
      r(-1, 3, 2, 4, cup);
      r(11, 3, 2, 4, cup);
    }
  }
}
