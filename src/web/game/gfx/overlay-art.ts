import type { Activity } from '../../../shared/protocol.ts';
import { DESK_SCREEN, FURNITURE_ANCHOR_X, FURNITURE_ANCHOR_Y } from './furniture-art.ts';
import { offset } from './iso.ts';
import { ART, OUTLINE } from './palette.ts';
import { hex, Pixmap, shade, type Color, type Point } from './pixmap.ts';

export type StatusIcon = Activity | 'sleeping' | 'coffee';

const INK: Record<string, Color> = {
  k: hex('#2a2438'),
  w: hex('#ffffff'),
  y: hex('#ffd447'),
  o: hex('#f0a63c'),
  b: hex('#4c8fe0'),
  l: hex('#9fd8ff'),
  g: hex('#4fc46a'),
  r: hex('#e45b5b'),
  p: hex('#c868d8'),
  s: hex('#f5c6a5'),
  c: hex('#8a5a3c'),
  e: hex('#9aa4b2'),
};

/** 9x9 glyphs; each one has its own silhouette so state never relies on color alone. */
const GLYPHS: Record<StatusIcon, readonly string[]> = {
  editing: [
    '.......kr',
    '......kyk',
    '.....kyk.',
    '....kyk..',
    '...kyk...',
    '..kyk....',
    '.kck.....',
    '.kk......',
    'k........',
  ],
  reading: [
    '.........',
    'kkkk.kkkk',
    'kwwwkwwwk',
    'kweekeewk',
    'kwwwkwwwk',
    'kweekeewk',
    'kwwwkwwwk',
    'kkkkkkkkk',
    '.........',
  ],
  running: [
    'kkkkkkkkk',
    'kgkkkkkkk',
    'kkgkkkkkk',
    'kgkkkkkkk',
    'kkkkkkkkk',
    'kkkkggggk',
    'kkkkkkkkk',
    'kkkkkkkkk',
    '.........',
  ],
  browsing: [
    '..kkkkk..',
    '.kbllblk.',
    'kbbgbbbbk',
    'klggblbbk',
    'kbbggbblk',
    'kblbgbbbk',
    'kbbbbgbbk',
    '.kbbbbbk.',
    '..kkkkk..',
  ],
  thinking: [
    '.........',
    '.........',
    '.........',
    '.........',
    'kk.kk.kk.',
    'kk.kk.kk.',
    '.........',
    '.........',
    '.........',
  ],
  delegating: [
    '.kk...kk.',
    'kssk.kssk',
    'kssk.kssk',
    '.kk...kk.',
    'kbbk.krrk',
    'kbbbkrrrk',
    'kbbbkrrrk',
    '.........',
    '.........',
  ],
  planning: [
    'kkkkkkkkk',
    'kwwwwwwwk',
    'kgwkkkkwk',
    'kwwwwwwwk',
    'kgwkkkkwk',
    'kwwwwwwwk',
    'kgwkkkwwk',
    'kwwwwwwwk',
    'kkkkkkkkk',
  ],
  waiting: [
    '...k.k...',
    '..kskskk.',
    '..kskskskk',
    '.kkssssssk',
    'kssksssssk',
    '.kssssssk',
    '..ksssssk',
    '...ksssk.',
    '....kkk..',
  ],
  sleeping: [
    '....kkkk.',
    '.....k...',
    '....k....',
    '...kkkk..',
    'kkk......',
    '..k......',
    '.k.......',
    'kkk......',
    '.........',
  ],
  coffee: [
    '..k.k....',
    '...k.k...',
    '.........',
    'kkkkkkk..',
    'kwwwwwkkk',
    'kwcccwk.k',
    'kwwwwwkkk',
    '.kwwwk...',
    '..kkk....',
  ],
};

const BUBBLE_SIZE = 15;

/** A status icon inside a small speech bubble with a tail, ready to draw above a head. */
export function drawStatusBubble(icon: StatusIcon): Pixmap {
  const pm = new Pixmap(BUBBLE_SIZE + 2, BUBBLE_SIZE + 5);
  const urgent = icon === 'waiting';
  const fill = urgent ? ART.yellow : ART.white;
  pm.rect(2, 1, BUBBLE_SIZE - 2, BUBBLE_SIZE, fill);
  pm.rect(1, 2, BUBBLE_SIZE, BUBBLE_SIZE - 2, fill);
  pm.rect(7, BUBBLE_SIZE + 1, 3, 1, fill);
  pm.rect(8, BUBBLE_SIZE + 2, 1, 1, fill);
  const glyph = GLYPHS[icon];
  glyph.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = INK[row.charAt(x)];
      if (color !== undefined) pm.set(4 + x, 4 + y, color);
    }
  });
  return pm.outline(OUTLINE);
}

export type ScreenPattern =
  'off' | 'saver' | 'code' | 'terminal' | 'doc' | 'web' | 'think' | 'chat' | 'alert';

export const SCREEN_FRAMES = 8;

export function screenPatternFor(activity: Activity): ScreenPattern {
  switch (activity) {
    case 'editing':
      return 'code';
    case 'running':
      return 'terminal';
    case 'reading':
      return 'doc';
    case 'browsing':
      return 'web';
    case 'thinking':
      return 'think';
    case 'delegating':
    case 'planning':
      return 'chat';
    case 'waiting':
      return 'alert';
  }
}

const CODE_COLORS = [
  hex('#ff7ab6'),
  hex('#7ad7ff'),
  hex('#ffd76a'),
  hex('#9cff8f'),
  hex('#c7b3ff'),
];

/**
 * Paints a monitor's content into a sprite that lines up with the desk sprite. Texture
 * coordinates (s across, t down) are recovered from the slanted screen quad.
 */
export function drawScreen(pattern: ScreenPattern, frame: number): Pixmap {
  const pm = new Pixmap(36, 64);
  const quad = offset(DESK_SCREEN, FURNITURE_ANCHOR_X, FURNITURE_ANCHOR_Y);
  const [topLeft, topRight, , bottomLeft] = quad as [Point, Point, Point, Point];
  const across = { x: topRight.x - topLeft.x, y: topRight.y - topLeft.y };
  const down = { x: bottomLeft.x - topLeft.x, y: bottomLeft.y - topLeft.y };
  const determinant = across.x * down.y - across.y * down.x;
  const xs = quad.map((point) => point.x);
  const ys = quad.map((point) => point.y);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y += 1) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x += 1) {
      const px = x + 0.5 - topLeft.x;
      const py = y + 0.5 - topLeft.y;
      const s = (px * down.y - py * down.x) / determinant;
      const t = (across.x * py - across.y * px) / determinant;
      if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;
      const color = screenColor(pattern, frame, s, t);
      if (color !== null) pm.set(x, y, color);
    }
  }
  return pm;
}

function screenColor(pattern: ScreenPattern, frame: number, s: number, t: number): Color | null {
  const row = Math.floor(t * 8);
  const column = Math.floor(s * 12);
  const dark = hex('#182233');
  switch (pattern) {
    case 'off':
      return null;
    case 'saver': {
      const position = (frame / SCREEN_FRAMES) * 12;
      return column === Math.floor(position) % 12 && row === Math.floor(frame / 2) % 8
        ? ART.yellow
        : dark;
    }
    case 'code': {
      const line = (row + frame) % 8;
      const length = 3 + ((line * 5) % 8);
      const indent = line % 3;
      if (column >= indent && column < indent + length && row < 8)
        return CODE_COLORS[line % CODE_COLORS.length] ?? ART.white;
      return hex('#1e1b2e');
    }
    case 'terminal': {
      const line = (row + frame) % 8;
      const length = 2 + ((line * 7) % 9);
      if (row === 7 && column === 1 && frame % 2 === 0) return ART.green;
      return column < length && row < 7 ? shade(ART.green, 0.8) : hex('#0c0f14');
    }
    case 'doc': {
      if (row % 2 === 1 && column > 0 && column < 11 - (row % 3)) return hex('#9aa4b2');
      return hex('#f4f6fa');
    }
    case 'web': {
      if (row < 2) return hex('#4c8fe0');
      if (row < 5 && column < 5) return frame % 4 < 2 ? hex('#f0a63c') : hex('#e45b5b');
      if (row % 2 === 1 && column > 5) return hex('#9aa4b2');
      return hex('#ffffff');
    }
    case 'think': {
      const dot = Math.floor(frame / 2) % 3;
      if (row === 4 && (column === 3 + dot * 3 || column === 4 + dot * 3)) return ART.white;
      return hex('#26304a');
    }
    case 'chat': {
      const mine = (row + Math.floor(frame / 3)) % 4 < 2;
      if (row % 2 === 0 && (mine ? column < 7 : column > 4))
        return mine ? hex('#9fd8ff') : hex('#ffd447');
      return hex('#1e2638');
    }
    case 'alert': {
      if (frame % 4 < 2 && (column === 5 || column === 6) && (row < 5 || row === 6))
        return ART.yellow;
      return hex('#2a2238');
    }
  }
}
