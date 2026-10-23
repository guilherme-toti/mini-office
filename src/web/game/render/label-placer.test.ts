import { describe, expect, it } from 'vitest';
import { LabelPlacer } from './label-placer.ts';

describe('label placer', () => {
  it('keeps labels where they asked to be when nothing is in the way', () => {
    const placer = new LabelPlacer(4);
    expect(placer.place(0, 100, 50, 20)).toBe(100);
    expect(placer.place(200, 100, 50, 20)).toBe(100);
  });

  it('stacks overlapping labels upwards with a gap', () => {
    const placer = new LabelPlacer(4);
    placer.place(0, 100, 50, 20);
    expect(placer.place(10, 105, 50, 20)).toBe(76);
    // A third one clears both.
    expect(placer.place(20, 110, 50, 20)).toBe(52);
  });
});
