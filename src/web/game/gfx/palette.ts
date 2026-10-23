import { hex, type Color } from './pixmap.ts';

/** The pixel-art palette. UI colors live in CSS tokens; these are paint for the canvas only. */
export const OUTLINE = hex('#1d1a2b');

export interface FloorStyle {
  a: Color;
  b: Color;
  pattern: 'checker' | 'planks' | 'carpet' | 'grass';
}

/** Every floor in the office. Zones pick theirs by index, so the bake stays a byte per tile. */
export const FLOOR_STYLES: readonly FloorStyle[] = [
  { a: hex('#e6d9bf'), b: hex('#ddcfb2'), pattern: 'planks' },
  { a: hex('#f2efe6'), b: hex('#2f3a4f'), pattern: 'checker' },
  { a: hex('#e8a87c'), b: hex('#de9c6f'), pattern: 'carpet' },
  { a: hex('#8a78c9'), b: hex('#8070bf'), pattern: 'carpet' },
  { a: hex('#b9c3cf'), b: hex('#aeb9c6'), pattern: 'carpet' },
  { a: hex('#7cc26a'), b: hex('#6fb65e'), pattern: 'grass' },
  { a: hex('#b07a4a'), b: hex('#a6703f'), pattern: 'planks' },
  { a: hex('#8fa7c9'), b: hex('#86a0c3'), pattern: 'carpet' },
  { a: hex('#c9b3d6'), b: hex('#bea6cc'), pattern: 'carpet' },
  { a: hex('#b8cfa8'), b: hex('#aec59d'), pattern: 'carpet' },
  { a: hex('#d6c08f'), b: hex('#ccb684'), pattern: 'carpet' },
  { a: hex('#9fc9c3'), b: hex('#93bfb9'), pattern: 'carpet' },
  { a: hex('#d9a3a3'), b: hex('#cf9898'), pattern: 'carpet' },
];

export const FLOOR = {
  corridor: 0,
  kitchen: 1,
  lounge: 2,
  games: 3,
  meeting: 4,
  grass: 5,
  deck: 6,
  /** Team carpets start here; each team gets one by hash. */
  teams: 7,
} as const;

export const TEAM_FLOOR_COUNT = FLOOR_STYLES.length - FLOOR.teams;

export const WALLS = {
  wall: hex('#cfe0ee'),
  trim: hex('#8aa6c2'),
  slab: hex('#7d6a58'),
} as const;

export const ART = {
  wood: hex('#b07a4a'),
  woodLight: hex('#cf9a64'),
  woodDark: hex('#7d5233'),
  metal: hex('#9aa4b2'),
  metalDark: hex('#5d6675'),
  plastic: hex('#eef1f5'),
  black: hex('#2a2d38'),
  screenOff: hex('#1d2633'),
  leaf: hex('#4caf50'),
  leafLight: hex('#7ed37a'),
  leafDark: hex('#2e7d32'),
  pot: hex('#c8643c'),
  water: hex('#7cc8f0'),
  sofa: [hex('#d9534f'), hex('#4c8fe0'), hex('#3fb6a8'), hex('#f0a63c')] as const,
  books: [
    hex('#e45b5b'),
    hex('#4c8fe0'),
    hex('#f2d44a'),
    hex('#7ccf6b'),
    hex('#c868d8'),
    hex('#f0a63c'),
  ] as const,
  chair: [hex('#3b4256'), hex('#4c8fe0'), hex('#e45b5b'), hex('#3fb6a8')] as const,
  sky: hex('#9fd8ff'),
  skyLight: hex('#d4f0ff'),
  door: hex('#2a2238'),
  white: hex('#ffffff'),
  red: hex('#ff5a5a'),
  green: hex('#5dff8a'),
  yellow: hex('#ffd447'),
} as const;
