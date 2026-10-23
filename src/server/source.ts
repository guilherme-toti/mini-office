import type {
  AgentSnapshot,
  OfficeSnapshot,
  RoomSnapshot,
  SourceName,
} from '../shared/protocol.ts';

export type SnapshotListener = (snapshot: OfficeSnapshot) => void;

/** Something that knows which agents are in the office. It only runs while someone listens. */
export interface OfficeSource {
  readonly name: SourceName;
  subscribe(listener: SnapshotListener): () => void;
}

/**
 * Shared plumbing for sources: starts on the first listener, stops after the last one leaves,
 * and only notifies when the office actually changed.
 */
export abstract class PollingSource implements OfficeSource {
  abstract readonly name: SourceName;
  private readonly listeners = new Set<SnapshotListener>();
  private snapshot: OfficeSnapshot | null = null;
  private fingerprint = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every start and stop, so a loop from an earlier run never reschedules itself. */
  private generation = 0;
  private running = false;
  /** Ticks and resets run one at a time, in order, even across a quick stop and restart. */
  private queue: Promise<void> = Promise.resolve();

  protected abstract readonly intervalMs: number;
  protected abstract tick(now: number): Promise<{ rooms: RoomSnapshot[]; agents: AgentSnapshot[] }>;
  protected onStop(): void {}

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    if (!this.running) {
      this.running = true;
      this.generation += 1;
      void this.loop(this.generation);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // A source that restarts from scratch must not greet its next listener with the old office.
    this.snapshot = null;
    this.fingerprint = '';
    void this.enqueue(() => {
      this.onStop();
      return Promise.resolve();
    });
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async loop(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    try {
      await this.enqueue(() => this.update(generation));
    } catch (error) {
      console.error(`[mini-office] ${this.name} source tick failed`, error);
    }
    if (generation === this.generation) {
      this.timer = setTimeout(() => void this.loop(generation), this.intervalMs);
    }
  }

  private async update(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    const now = Date.now();
    const { rooms, agents } = await this.tick(now);
    if (generation !== this.generation) return;
    const fingerprint = JSON.stringify({ rooms, agents });
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.snapshot = { source: this.name, at: now, rooms, agents };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
