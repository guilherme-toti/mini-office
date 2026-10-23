import { describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../shared/protocol.ts';
import { DemoSource } from './demo/demo-source.ts';

describe('polling sources', () => {
  it('start from a clean office after the last listener left', async () => {
    const source = new DemoSource();
    const first = await new Promise<OfficeSnapshot>((resolve) => {
      const stop = source.subscribe((snapshot) => {
        stop();
        resolve(snapshot);
      });
    });
    expect(first.agents.length).toBeGreaterThan(0);

    const replayed: OfficeSnapshot[] = [];
    const stop = source.subscribe((snapshot) => replayed.push(snapshot));
    // Subscribing replays the cached snapshot synchronously; after a restart there is none.
    expect(replayed).toHaveLength(0);
    stop();
  });
});
