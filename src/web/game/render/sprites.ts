import { drawAvatar, type AvatarFrame } from '../gfx/avatar-art.ts';
import { bakeFloor, drawFloorTile, type FloorArt } from '../gfx/floor-art.ts';
import { drawFurniture } from '../gfx/furniture-art.ts';
import {
  drawScreen,
  drawStatusBubble,
  type ScreenPattern,
  type StatusIcon,
} from '../gfx/overlay-art.ts';
import { FLOOR_STYLES } from '../gfx/palette.ts';
import { Pixmap } from '../gfx/pixmap.ts';
import type { Dir, FloorPlan, FurnitureKind } from '../layout/types.ts';
import { lookKey } from '../sim/persona.ts';

const MAX_SPRITES = 2500;

export interface Sprite {
  canvas: HTMLCanvasElement;
  pm: Pixmap;
}

export interface BakedFloor {
  floor: HTMLCanvasElement;
  walls: HTMLCanvasElement;
  originX: number;
  originY: number;
}

export function toCanvas(pm: Pixmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = pm.width;
  canvas.height = pm.height;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const image = context.createImageData(pm.width, pm.height);
  for (let index = 0; index < pm.pixels.length; index += 1) {
    const color = pm.pixels[index] ?? 0;
    image.data[index * 4] = (color >>> 24) & 0xff;
    image.data[index * 4 + 1] = (color >>> 16) & 0xff;
    image.data[index * 4 + 2] = (color >>> 8) & 0xff;
    image.data[index * 4 + 3] = color & 0xff;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function mirrored(pm: Pixmap): Pixmap {
  const copy = new Pixmap(pm.width, pm.height);
  copy.blit(pm, 0, 0, true);
  return copy;
}

/** Every sprite is drawn once into a canvas and reused for the rest of the session. */
export class SpriteCache {
  private readonly sprites = new Map<string, Sprite>();
  private baked: { key: string; art: BakedFloor } | null = null;

  /** Least recently used first: a Map keeps insertion order, and every hit re-inserts. */
  private get(key: string, make: () => Pixmap): Sprite {
    let sprite = this.sprites.get(key);
    if (sprite) {
      this.sprites.delete(key);
    } else {
      const pm = make();
      sprite = { pm, canvas: toCanvas(pm) };
      // An always-open tab sees hundreds of short-lived helpers; forget the ones long gone.
      if (this.sprites.size >= MAX_SPRITES) {
        const oldest = this.sprites.keys().next().value;
        if (oldest !== undefined) this.sprites.delete(oldest);
      }
    }
    this.sprites.set(key, sprite);
    return sprite;
  }

  avatar(frame: AvatarFrame, mirror: boolean): Sprite {
    const key = `avatar|${lookKey(frame.look)}|${frame.view}|${frame.pose}|${frame.frame}|${frame.badge}|${mirror}`;
    return this.get(key, () => {
      const pm = drawAvatar(frame);
      return mirror ? mirrored(pm) : pm;
    });
  }

  furniture(kind: FurnitureKind, variant: number, facing: Dir): Sprite {
    return this.get(`furniture|${kind}|${variant}|${facing}`, () =>
      drawFurniture(kind, variant, facing),
    );
  }

  screen(pattern: ScreenPattern, frame: number): Sprite {
    return this.get(`screen|${pattern}|${frame}`, () => drawScreen(pattern, frame));
  }

  status(icon: StatusIcon): Sprite {
    return this.get(`status|${icon}`, () => drawStatusBubble(icon));
  }

  floorTile(style: number, parity: number, seed: number): Sprite {
    return this.get(`tile|${style}|${parity}|${seed}`, () => {
      const floorStyle = FLOOR_STYLES[style] ?? FLOOR_STYLES[0];
      return floorStyle ? drawFloorTile(floorStyle, parity, seed) : new Pixmap(32, 16);
    });
  }

  /** The whole floor, re-baked only when the plan or the set of areas being built changes. */
  floor(plan: FloorPlan, key: string, skip: (x: number, y: number) => boolean): BakedFloor {
    if (this.baked?.key !== key) {
      const art: FloorArt = bakeFloor(plan, skip);
      this.baked = {
        key,
        art: {
          floor: toCanvas(art.floor),
          walls: toCanvas(art.walls),
          originX: art.originX,
          originY: art.originY,
        },
      };
    }
    return this.baked.art;
  }
}
