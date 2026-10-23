/** A color packed as 0xRRGGBBAA. */
export type Color = number;

export interface Point {
  x: number;
  y: number;
}

export function hex(value: string, alpha = 255): Color {
  const clean = value.replace('#', '');
  return ((Number.parseInt(clean, 16) << 8) | alpha) >>> 0;
}

/** Scales the RGB channels: < 1 darkens, > 1 lightens. */
export function shade(color: Color, factor: number): Color {
  const channel = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((color >>> shift) & 0xff) * factor)));
  return ((channel(24) << 24) | (channel(16) << 16) | (channel(8) << 8) | (color & 0xff)) >>> 0;
}

/**
 * A tiny software raster for pixel art. Shapes are filled by testing pixel centers, so 2:1
 * isometric edges come out crisp and neighbouring tiles never overlap or leave gaps.
 */
export class Pixmap {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint32Array;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.pixels = new Uint32Array(this.width * this.height);
  }

  get(x: number, y: number): Color {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.pixels[y * this.width + x] ?? 0;
  }

  set(x: number, y: number, color: Color): void {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const alpha = color & 0xff;
    if (alpha === 0) return;
    const index = py * this.width + px;
    if (alpha === 255) {
      this.pixels[index] = color;
      return;
    }
    this.pixels[index] = blend(this.pixels[index] ?? 0, color);
  }

  rect(x: number, y: number, width: number, height: number, color: Color): void {
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) this.set(x + column, y + row, color);
    }
  }

  /** Fills a convex or concave polygon (even-odd rule). */
  poly(points: readonly Point[], color: Color): void {
    if (points.length < 3) return;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(...xs)));
    for (let y = minY; y <= maxY; y += 1) {
      const cy = y + 0.5;
      const crossings: number[] = [];
      for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        if (!a || !b) continue;
        if (a.y <= cy === b.y <= cy) continue;
        crossings.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      crossings.sort((left, right) => left - right);
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const from = Math.max(minX, Math.ceil((crossings[index] ?? 0) - 0.5));
        const to = Math.min(maxX, Math.floor((crossings[index + 1] ?? 0) - 0.5));
        for (let x = from; x <= to; x += 1) this.set(x, y, color);
      }
    }
  }

  /** Draws another pixmap on top of this one. */
  blit(source: Pixmap, x: number, y: number, mirror = false): void {
    for (let row = 0; row < source.height; row += 1) {
      for (let column = 0; column < source.width; column += 1) {
        const color = source.pixels[row * source.width + column] ?? 0;
        const targetX = mirror ? x + source.width - 1 - column : x + column;
        this.set(targetX, y + row, color);
      }
    }
  }

  /** Paints a 1px outline around every opaque area, the Habbo look. */
  outline(color: Color): this {
    const copy = this.pixels.slice();
    const opaque = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height &&
      ((copy[y * this.width + x] ?? 0) & 0xff) > 80;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (opaque(x, y)) continue;
        if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
          this.pixels[y * this.width + x] = color;
        }
      }
    }
    return this;
  }

  isOpaqueAt(x: number, y: number): boolean {
    return (this.get(Math.floor(x), Math.floor(y)) & 0xff) > 0;
  }
}

function blend(under: Color, over: Color): Color {
  const alpha = (over & 0xff) / 255;
  const underAlpha = (under & 0xff) / 255;
  const outAlpha = alpha + underAlpha * (1 - alpha);
  if (outAlpha === 0) return 0;
  const mix = (shift: number) => {
    const top = (over >>> shift) & 0xff;
    const bottom = (under >>> shift) & 0xff;
    return Math.round((top * alpha + bottom * underAlpha * (1 - alpha)) / outAlpha);
  };
  return ((mix(24) << 24) | (mix(16) << 16) | (mix(8) << 8) | Math.round(outAlpha * 255)) >>> 0;
}
