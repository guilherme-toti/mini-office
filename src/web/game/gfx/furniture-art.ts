import type { Dir, FurnitureKind } from '../layout/types.ts';
import { at, box, faces, leftFaceQuad, offset, type Box, type Canvas2 } from './iso.ts';
import { ART, OUTLINE } from './palette.ts';
import { hex, Pixmap, shade, type Color, type Point } from './pixmap.ts';

const SPRITE_W = 36;
const MAX_Z = 42;
const SPRITE_H = 16 + MAX_Z + 6;
export const FURNITURE_ANCHOR_X = 18;
export const FURNITURE_ANCHOR_Y = MAX_Z + 3;

/** The monitor screen on a desk, relative to the tile's top corner. Filled live by the renderer. */
export const DESK_SCREEN: readonly Point[] = leftFaceQuad(0.25, 0.75, 0.36, 17, 26);

function canvas(): Canvas2 {
  return {
    pm: new Pixmap(SPRITE_W, SPRITE_H),
    anchorX: FURNITURE_ANCHOR_X,
    anchorY: FURNITURE_ANCHOR_Y,
  };
}

function b(u0: number, u1: number, v0: number, v1: number, z0: number, z1: number): Box {
  return { u0, u1, v0, v1, z0, z1 };
}

function solid(c: Canvas2, shape: Box, color: Color): void {
  box(c, shape, faces(color));
}

function quad(c: Canvas2, points: readonly Point[], color: Color): void {
  c.pm.poly(offset(points, c.anchorX, c.anchorY), color);
}

function ellipse(
  c: Canvas2,
  u: number,
  v: number,
  z: number,
  rx: number,
  ry: number,
  color: Color,
): void {
  const center = at(c, u, v, z);
  for (let y = -ry; y <= ry; y += 1) {
    for (let x = -rx; x <= rx; x += 1) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1)
        c.pm.set(center.x + x, center.y + y, color);
    }
  }
}

function leaves(c: Canvas2, z: number, spread: number): void {
  const clusters: [number, number, number, number][] = [
    [0, 0, 6, 4],
    [-4, -4, 5, 4],
    [4, -5, 5, 4],
    [0, -9, 5, 4],
    [-6, 2, 4, 3],
    [6, 1, 4, 3],
  ];
  for (const [dx, dy, rx, ry] of clusters) {
    const center = at(c, 0.5, 0.5, z);
    const color = dy < -6 ? ART.leafLight : dx < 0 ? ART.leaf : ART.leafDark;
    for (let y = -ry; y <= ry; y += 1) {
      for (let x = -rx; x <= rx; x += 1) {
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) {
          c.pm.set(center.x + dx * spread + x, center.y + dy * spread + y, color);
        }
      }
    }
  }
}

const painters: Record<FurnitureKind, (c: Canvas2, variant: number, facing: Dir) => void> = {
  desk(c, variant) {
    solid(c, b(0.06, 0.2, 0.16, 0.9, 0, 11), ART.woodDark);
    solid(c, b(0.8, 0.94, 0.16, 0.9, 0, 11), ART.woodDark);
    solid(c, b(0.2, 0.8, 0.16, 0.24, 3, 11), ART.wood);
    solid(c, b(0.04, 0.96, 0.12, 0.92, 11, 13), ART.woodLight);
    solid(c, b(0.3, 0.7, 0.62, 0.78, 13, 14), ART.plastic);
    solid(c, b(0.45, 0.55, 0.28, 0.36, 13, 17), ART.metalDark);
    solid(c, b(0.2, 0.8, 0.26, 0.36, 16, 27), ART.black);
    quad(c, DESK_SCREEN, ART.screenOff);
    if (variant % 2 === 1)
      solid(c, b(0.82, 0.92, 0.58, 0.7, 13, 17), ART.sofa[variant % ART.sofa.length] ?? ART.red);
    if (variant === 2) solid(c, b(0.08, 0.22, 0.5, 0.7, 13, 14), ART.yellow);
  },
  chair(c, variant, facing) {
    const color = ART.chair[variant % ART.chair.length] ?? ART.black;
    const back = shade(color, 0.9);
    // The backrest sits behind the sitter; ones on the far side are drawn before the seat.
    const backrest: Record<Dir, Box> = {
      ne: b(0.24, 0.76, 0.7, 0.82, 10, 20),
      sw: b(0.24, 0.76, 0.18, 0.3, 10, 20),
      se: b(0.18, 0.3, 0.24, 0.76, 10, 20),
      nw: b(0.7, 0.82, 0.24, 0.76, 10, 20),
    };
    const far = facing === 'sw' || facing === 'se';
    if (far) solid(c, backrest[facing], back);
    solid(c, b(0.32, 0.68, 0.32, 0.68, 0, 2), ART.metalDark);
    solid(c, b(0.45, 0.55, 0.45, 0.55, 2, 7), ART.metal);
    solid(c, b(0.24, 0.76, 0.24, 0.76, 7, 10), color);
    if (!far) solid(c, backrest[facing], back);
  },
  plant(c, variant) {
    solid(c, b(0.3, 0.7, 0.3, 0.7, 0, 8), variant % 2 ? hex('#e8e4d8') : ART.pot);
    leaves(c, 14, 0.8);
  },
  bigPlant(c) {
    solid(c, b(0.25, 0.75, 0.25, 0.75, 0, 11), ART.pot);
    solid(c, b(0.47, 0.53, 0.47, 0.53, 11, 22), ART.woodDark);
    leaves(c, 28, 1.25);
  },
  bookshelf(c, variant) {
    solid(c, b(0.05, 0.95, 0.08, 0.5, 0, 38), ART.wood);
    for (const level of [3, 15, 27]) {
      quad(c, leftFaceQuad(0.1, 0.9, 0.5, level, level + 10), ART.woodDark);
      for (let index = 0; index < 8; index += 1) {
        const u = 0.12 + index * 0.095;
        const height = 6 + ((index * 7 + variant * 3 + level) % 4);
        const color = ART.books[(index + variant + level) % ART.books.length] ?? ART.red;
        quad(c, leftFaceQuad(u, u + 0.07, 0.5, level + 1, level + height), color);
      }
    }
  },
  printer(c) {
    solid(c, b(0.1, 0.9, 0.2, 0.8, 0, 11), ART.metal);
    quad(c, leftFaceQuad(0.2, 0.8, 0.8, 4, 6), ART.metalDark);
    solid(c, b(0.15, 0.85, 0.25, 0.75, 11, 18), ART.plastic);
    solid(c, b(0.3, 0.7, 0.3, 0.5, 18, 19), ART.white);
    quad(c, leftFaceQuad(0.7, 0.78, 0.75, 14, 16), ART.green);
  },
  server(c) {
    solid(c, b(0.15, 0.85, 0.15, 0.7, 0, 36), ART.black);
    for (let row = 0; row < 6; row += 1) {
      const z = 4 + row * 5;
      quad(c, leftFaceQuad(0.2, 0.8, 0.7, z, z + 3), shade(ART.black, 1.35));
      quad(c, leftFaceQuad(0.68, 0.74, 0.7, z + 1, z + 2), row % 2 ? ART.green : ART.yellow);
    }
  },
  cabinet(c) {
    solid(c, b(0.12, 0.88, 0.2, 0.75, 0, 18), ART.metal);
    for (const z of [6, 12]) quad(c, leftFaceQuad(0.15, 0.85, 0.75, z, z + 1), ART.metalDark);
    for (const z of [3, 9, 15]) quad(c, leftFaceQuad(0.45, 0.55, 0.75, z, z + 1), ART.white);
  },
  cooler(c) {
    solid(c, b(0.3, 0.7, 0.3, 0.7, 0, 15), ART.plastic);
    quad(c, leftFaceQuad(0.42, 0.5, 0.7, 9, 11), ART.red);
    quad(c, leftFaceQuad(0.52, 0.6, 0.7, 9, 11), hex('#4c8fe0'));
    solid(c, b(0.33, 0.67, 0.33, 0.67, 15, 28), hex('#7cc8f0', 220));
    solid(c, b(0.43, 0.57, 0.43, 0.57, 28, 30), hex('#4c8fe0'));
  },
  coffee(c) {
    solid(c, b(0, 1, 0.1, 0.72, 0, 14), ART.wood);
    solid(c, b(0, 1, 0.1, 0.72, 13, 15), ART.plastic);
    solid(c, b(0.2, 0.75, 0.14, 0.48, 15, 30), ART.black);
    quad(c, leftFaceQuad(0.3, 0.65, 0.48, 22, 27), shade(ART.black, 1.5));
    quad(c, leftFaceQuad(0.58, 0.64, 0.48, 23, 25), ART.red);
    solid(c, b(0.38, 0.52, 0.5, 0.62, 15, 18), ART.white);
  },
  counter(c, variant) {
    solid(c, b(0, 1, 0.1, 0.72, 0, 14), ART.wood);
    solid(c, b(0, 1, 0.1, 0.72, 13, 15), ART.plastic);
    quad(c, leftFaceQuad(0.48, 0.52, 0.72, 4, 10), ART.woodDark);
    if (variant % 2 === 0) {
      solid(c, b(0.2, 0.8, 0.15, 0.5, 15, 23), ART.plastic);
      quad(c, leftFaceQuad(0.26, 0.6, 0.5, 16, 22), ART.black);
    } else {
      solid(c, b(0.25, 0.4, 0.3, 0.45, 15, 18), ART.sofa[1]);
      solid(c, b(0.5, 0.65, 0.3, 0.45, 15, 18), ART.sofa[3]);
    }
  },
  vending(c) {
    solid(c, b(0.08, 0.92, 0.1, 0.6, 0, 40), hex('#d9534f'));
    quad(c, leftFaceQuad(0.14, 0.66, 0.6, 12, 36), hex('#22304a'));
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const u = 0.18 + col * 0.12;
        const z = 15 + row * 5.5;
        quad(
          c,
          leftFaceQuad(u, u + 0.08, 0.6, z, z + 3),
          ART.books[(row + col) % ART.books.length] ?? ART.yellow,
        );
      }
    }
    quad(c, leftFaceQuad(0.72, 0.86, 0.6, 20, 30), shade(hex('#d9534f'), 0.7));
    quad(c, leftFaceQuad(0.18, 0.6, 0.6, 4, 8), ART.black);
  },
  fridge(c) {
    solid(c, b(0.1, 0.9, 0.1, 0.6, 0, 38), ART.plastic);
    quad(c, leftFaceQuad(0.12, 0.88, 0.6, 24, 25), ART.metal);
    quad(c, leftFaceQuad(0.78, 0.82, 0.6, 27, 34), ART.metalDark);
    quad(c, leftFaceQuad(0.78, 0.82, 0.6, 12, 20), ART.metalDark);
  },
  arcade(c) {
    const body = hex('#6a4bc4');
    solid(c, b(0.15, 0.85, 0.1, 0.55, 0, 36), body);
    quad(c, leftFaceQuad(0.22, 0.78, 0.55, 19, 29), hex('#0f1630'));
    quad(c, leftFaceQuad(0.3, 0.45, 0.55, 22, 25), ART.green);
    quad(c, leftFaceQuad(0.55, 0.7, 0.55, 24, 27), ART.red);
    quad(c, leftFaceQuad(0.18, 0.82, 0.55, 31, 35), ART.yellow);
    solid(c, b(0.15, 0.85, 0.55, 0.7, 13, 16), ART.black);
    solid(c, b(0.35, 0.42, 0.6, 0.66, 16, 19), ART.red);
  },
  sofa(c, variant, facing) {
    const color = ART.sofa[0];
    const towardViewer = facing === 'ne';
    const seat = towardViewer ? b(0, 1, 0.1, 0.78, 0, 9) : b(0, 1, 0.22, 0.9, 0, 9);
    const backrest = towardViewer ? b(0, 1, 0.66, 0.9, 9, 20) : b(0, 1, 0.1, 0.34, 9, 20);
    if (!towardViewer) solid(c, backrest, shade(color, 0.92));
    solid(c, seat, color);
    if (variant === 0) solid(c, b(0, 0.18, seat.v0, seat.v1, 9, 14), shade(color, 1.05));
    if (variant === 2) solid(c, b(0.82, 1, seat.v0, seat.v1, 9, 14), shade(color, 1.05));
    if (towardViewer) solid(c, backrest, shade(color, 0.92));
  },
  tree(c, variant) {
    solid(c, b(0.44, 0.56, 0.44, 0.56, 0, 18), ART.woodDark);
    const canopy = variant % 2 === 0 ? ART.leafDark : ART.leaf;
    ellipse(c, 0.5, 0.5, 30, 13, 10, canopy);
    ellipse(c, 0.42, 0.42, 36, 9, 7, ART.leaf);
    ellipse(c, 0.5, 0.5, 41, 5, 4, ART.leafLight);
  },
  flowers(c, variant) {
    solid(c, b(0.08, 0.92, 0.08, 0.92, 0, 5), ART.woodDark);
    solid(c, b(0.14, 0.86, 0.14, 0.86, 5, 6), hex('#6b4a2e'));
    const petals = [ART.red, ART.yellow, hex('#ef7fae'), hex('#ffffff'), hex('#c868d8')];
    for (let index = 0; index < 7; index += 1) {
      const u = 0.22 + ((index * 37 + variant * 13) % 56) / 100;
      const v = 0.22 + ((index * 53 + variant * 7) % 56) / 100;
      ellipse(c, u, v, 9, 1, 1, petals[(index + variant) % petals.length] ?? ART.red);
      ellipse(c, u, v, 7, 1, 1, ART.leaf);
    }
  },
  tv(c) {
    solid(c, b(0.08, 0.92, 0.2, 0.62, 0, 9), ART.woodDark);
    solid(c, b(0.12, 0.88, 0.26, 0.36, 9, 28), ART.black);
    quad(c, leftFaceQuad(0.16, 0.84, 0.36, 11, 26), hex('#5ab0ff'));
    quad(c, leftFaceQuad(0.16, 0.84, 0.36, 11, 15), ART.leaf);
    quad(c, leftFaceQuad(0.3, 0.38, 0.36, 15, 19), ART.red);
    quad(c, leftFaceQuad(0.6, 0.7, 0.36, 20, 23), ART.yellow);
    solid(c, b(0.6, 0.8, 0.42, 0.58, 9, 11), ART.plastic);
  },
  beanbag(c, variant) {
    const color = ART.sofa[variant % ART.sofa.length] ?? ART.red;
    ellipse(c, 0.5, 0.5, 4, 10, 5, shade(color, 0.85));
    ellipse(c, 0.5, 0.5, 7, 9, 4, color);
    ellipse(c, 0.45, 0.45, 9, 4, 2, shade(color, 1.15));
  },
  pingpong(c, variant) {
    const green = hex('#2f8f5b');
    solid(c, b(0.2, 0.3, 0.3, 0.4, 0, 13), ART.metalDark);
    solid(c, b(0.7, 0.8, 0.6, 0.7, 0, 13), ART.metalDark);
    solid(c, b(0, 1, 0.15, 0.85, 13, 15), green);
    quad(c, leftFaceQuad(0, 1, 0.85, 13, 15), shade(green, 0.8));
    const netU = variant === 0 ? 0.94 : 0;
    solid(c, b(netU, netU + 0.06, 0.12, 0.88, 15, 19), hex('#f4f6fa', 200));
  },
  meetingTable(c) {
    solid(c, b(0.42, 0.58, 0.42, 0.58, 0, 10), ART.metalDark);
    solid(c, b(0, 1, 0, 1, 10, 13), ART.woodLight);
  },
  parasol(c) {
    solid(c, b(0.3, 0.7, 0.3, 0.7, 0, 2), ART.metalDark);
    solid(c, b(0.47, 0.53, 0.47, 0.53, 2, 34), ART.metal);
    solid(c, b(0.15, 0.85, 0.15, 0.85, 13, 15), ART.white);
    solid(c, b(-0.1, 1.1, -0.1, 1.1, 33, 35), hex('#ff7a5c'));
    solid(c, b(0.1, 0.9, 0.1, 0.9, 35, 37), hex('#fff1d6'));
    solid(c, b(0.35, 0.65, 0.35, 0.65, 37, 39), hex('#ff7a5c'));
  },
  bench(c) {
    solid(c, b(0.08, 0.16, 0.3, 0.7, 0, 6), ART.woodDark);
    solid(c, b(0.84, 0.92, 0.3, 0.7, 0, 6), ART.woodDark);
    solid(c, b(0, 1, 0.28, 0.72, 6, 8), ART.wood);
    solid(c, b(0, 1, 0.66, 0.74, 8, 16), ART.wood);
  },
  partition(c, variant) {
    // Low and mostly glass, so people stay visible behind them.
    const frame = hex('#aab6c4');
    const glass = hex('#d8f1ff', 90);
    const arm = (u0: number, u1: number, v0: number, v1: number) => {
      solid(c, b(u0, u1, v0, v1, 0, 5), frame);
      solid(c, b(u0, u1, v0, v1, 5, 16), glass);
      solid(c, b(u0, u1, v0, v1, 16, 18), frame);
    };
    const t0 = 0.45;
    const t1 = 0.55;
    // Far arms first, then the post, then the arms that come toward the viewer.
    if (variant & 1) arm(t0, t1, 0, 0.5);
    if (variant & 8) arm(0, 0.5, t0, t1);
    solid(c, b(t0, t1, t0, t1, 0, 19), frame);
    if (variant & 2) arm(0.5, 1, t0, t1);
    if (variant & 4) arm(t0, t1, 0.5, 1);
  },
  coffeeTable(c, variant) {
    solid(c, b(0.1, 0.9, 0.22, 0.78, 0, 6), ART.woodDark);
    solid(c, b(0.08, 0.92, 0.2, 0.8, 6, 8), ART.woodLight);
    if (variant === 1) solid(c, b(0.4, 0.55, 0.4, 0.55, 8, 11), ART.white);
  },
  lamp(c) {
    solid(c, b(0.38, 0.62, 0.38, 0.62, 0, 2), ART.metalDark);
    solid(c, b(0.48, 0.52, 0.48, 0.52, 2, 28), ART.metalDark);
    solid(c, b(0.3, 0.7, 0.3, 0.7, 26, 35), hex('#ffe9a8'));
  },
  bin(c) {
    solid(c, b(0.32, 0.68, 0.32, 0.68, 0, 9), ART.metal);
    ellipse(c, 0.5, 0.5, 9, 3, 1, ART.metalDark);
    solid(c, b(0.44, 0.56, 0.44, 0.56, 8, 11), ART.white);
  },
};

export function drawFurniture(kind: FurnitureKind, variant: number, facing: Dir): Pixmap {
  const c = canvas();
  painters[kind](c, variant, facing);
  return c.pm.outline(OUTLINE);
}
