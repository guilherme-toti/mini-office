import { hex, type Color } from './pixmap.ts';

/** The pixel-art palette. UI colors live in CSS tokens; these are paint for the canvas only. */
export const OUTLINE = hex('#1d1a2b');

export interface RoomTheme {
  floorA: Color;
  floorB: Color;
  floorStyle: 'checker' | 'planks' | 'carpet';
  wall: Color;
  wallTrim: Color;
  slab: Color;
}

export const ROOM_THEMES: readonly RoomTheme[] = [
  {
    floorA: hex('#d9c7a3'),
    floorB: hex('#cfbb94'),
    floorStyle: 'planks',
    wall: hex('#b9d2e8'),
    wallTrim: hex('#7d9cbb'),
    slab: hex('#8f7a5a'),
  },
  {
    floorA: hex('#c8d4dc'),
    floorB: hex('#b9c6cf'),
    floorStyle: 'checker',
    wall: hex('#f1dcc0'),
    wallTrim: hex('#c4a27c'),
    slab: hex('#7c8a96'),
  },
  {
    floorA: hex('#8fa7c9'),
    floorB: hex('#86a0c3'),
    floorStyle: 'carpet',
    wall: hex('#e8e4d8'),
    wallTrim: hex('#a9a291'),
    slab: hex('#5a6e8c'),
  },
  {
    floorA: hex('#c9b3d6'),
    floorB: hex('#bea6cc'),
    floorStyle: 'carpet',
    wall: hex('#f5eaf0'),
    wallTrim: hex('#bfa3b4'),
    slab: hex('#7d6a8c'),
  },
  {
    floorA: hex('#b8cfa8'),
    floorB: hex('#aec59d'),
    floorStyle: 'checker',
    wall: hex('#f3ecd3'),
    wallTrim: hex('#c3b78f'),
    slab: hex('#6f8560'),
  },
  {
    floorA: hex('#c49a74'),
    floorB: hex('#b88f69'),
    floorStyle: 'planks',
    wall: hex('#d7e7df'),
    wallTrim: hex('#8fb3a3'),
    slab: hex('#7a5a40'),
  },
];

export const LOUNGE_THEME: RoomTheme = {
  floorA: hex('#f2efe6'),
  floorB: hex('#2f3a4f'),
  floorStyle: 'checker',
  wall: hex('#ffd9a8'),
  wallTrim: hex('#d69a5c'),
  slab: hex('#5c4a3a'),
};

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
