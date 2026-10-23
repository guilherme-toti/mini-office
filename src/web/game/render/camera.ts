import type { Rect } from '../layout/office-layout.ts';

/** Device pixels per art pixel. Whole numbers keep the pixel art crisp; 1.5 bridges the big jump. */
const SCALES = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8] as const;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Pans and zooms over the office, in art pixels; eases toward its targets. */
export class Camera {
  x = 0;
  y = 0;
  scale = 2;
  targetX = 0;
  targetY = 0;
  targetScale = 2;
  /** True until the user pans or zooms by hand; then the office stops refitting itself. */
  autoFit = true;

  fit(bounds: Rect, width: number, height: number, insets: Insets, instant = false): void {
    const usableW = Math.max(1, width - insets.left - insets.right);
    const usableH = Math.max(1, height - insets.top - insets.bottom);
    const fitting = SCALES.filter(
      (scale) => bounds.width * scale <= usableW && bounds.height * scale <= usableH,
    );
    this.targetScale = fitting.at(-1) ?? SCALES[0];
    // Center the office inside the free area, not the whole canvas.
    const shiftX = (insets.left - insets.right) / 2 / this.targetScale;
    const shiftY = (insets.top - insets.bottom) / 2 / this.targetScale;
    this.targetX = bounds.x + bounds.width / 2 - shiftX;
    this.targetY = bounds.y + bounds.height / 2 - shiftY;
    if (instant) this.snap();
  }

  focus(x: number, y: number, minScale: number): void {
    this.autoFit = false;
    this.targetX = x;
    this.targetY = y;
    this.targetScale = Math.max(
      this.targetScale,
      SCALES.find((scale) => scale >= minScale) ?? minScale,
    );
  }

  panBy(dx: number, dy: number): void {
    this.autoFit = false;
    this.targetX -= dx / this.scale;
    this.targetY -= dy / this.scale;
    this.x = this.targetX;
    this.y = this.targetY;
  }

  /** Steps the zoom, keeping the art pixel under (anchorX, anchorY) in place. */
  zoomStep(
    direction: 1 | -1,
    anchorX: number,
    anchorY: number,
    width: number,
    height: number,
  ): void {
    this.autoFit = false;
    const index = SCALES.findIndex((scale) => scale >= this.targetScale - 0.01);
    const next =
      SCALES[Math.min(SCALES.length - 1, Math.max(0, index + direction))] ?? this.targetScale;
    if (next === this.targetScale) return;
    const worldX = this.targetX + (anchorX - width / 2) / this.targetScale;
    const worldY = this.targetY + (anchorY - height / 2) / this.targetScale;
    this.targetX = worldX - (anchorX - width / 2) / next;
    this.targetY = worldY - (anchorY - height / 2) / next;
    this.targetScale = next;
  }

  snap(): void {
    this.x = this.targetX;
    this.y = this.targetY;
    this.scale = this.targetScale;
  }

  update(dt: number): void {
    const blend = 1 - Math.exp(-dt * 9);
    this.x += (this.targetX - this.x) * blend;
    this.y += (this.targetY - this.y) * blend;
    this.scale += (this.targetScale - this.scale) * blend;
    if (Math.abs(this.targetScale - this.scale) < 0.01) this.scale = this.targetScale;
  }

  /** The integer device-pixel offset that maps art pixels onto the canvas. */
  offset(width: number, height: number): { x: number; y: number } {
    return {
      x: Math.round(width / 2 - this.x * this.scale),
      y: Math.round(height / 2 - this.y * this.scale),
    };
  }
}
