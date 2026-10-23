export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Keeps screen labels (room plates, names, speech) from covering each other: each new label
 * slides up until it clears every label placed before it this frame, like a Habbo chat stack.
 */
export class LabelPlacer {
  private readonly boxes: LabelBox[] = [];
  private readonly gap: number;

  constructor(gap: number) {
    this.gap = gap;
  }

  /** Returns the top edge the label should be drawn at. */
  place(x: number, y: number, width: number, height: number): number {
    let top = y;
    // Each move clears one box, so this ends after at most one pass over the placed labels.
    for (let guard = 0; guard <= this.boxes.length; guard += 1) {
      const hit = this.boxes.find(
        (box) =>
          x < box.x + box.width &&
          box.x < x + width &&
          top < box.y + box.height + this.gap &&
          box.y < top + height + this.gap,
      );
      if (!hit) break;
      top = hit.y - height - this.gap;
    }
    this.boxes.push({ x, y: top, width, height });
    return top;
  }
}
