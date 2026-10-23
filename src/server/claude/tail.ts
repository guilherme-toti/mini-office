import { open, stat } from 'node:fs/promises';
import { applyTranscriptLine, emptyTranscriptState, type TranscriptState } from './transcript.ts';

/** How much of an existing transcript is read on first sight, before widening. */
const INITIAL_TAIL_BYTES = 512 * 1024;
/**
 * Screenshots and other tool output can be megabytes per line, so the first look widens until
 * it finds the latest request and a few steps, up to this much.
 */
const MAX_FIRST_LOOK_BYTES = 16 * 1024 * 1024;
const ENOUGH_STEPS = 4;
const NEWLINE = 0x0a;

/** Follows one JSONL transcript, reading only the bytes appended since the last poll. */
export class TranscriptTail {
  readonly path: string;
  state: TranscriptState = emptyTranscriptState();
  mtimeMs = 0;
  private offset = -1;
  /** The unfinished last line, kept as bytes so a character split across reads stays whole. */
  private remainder: Buffer = Buffer.alloc(0);

  constructor(path: string) {
    this.path = path;
  }

  async poll(now: number): Promise<void> {
    let size: number;
    try {
      const info = await stat(this.path);
      size = info.size;
      this.mtimeMs = info.mtimeMs;
    } catch {
      return;
    }
    if (size < this.offset) this.reset();
    if (size === this.offset) return;
    if (this.offset < 0) {
      await this.firstLook(size, now);
      return;
    }
    const chunk = await this.read(this.offset, size);
    if (!chunk) return;
    this.offset += chunk.length;
    this.state = this.apply(this.state, Buffer.concat([this.remainder, chunk]), now);
  }

  private async firstLook(size: number, now: number): Promise<void> {
    for (let window = INITIAL_TAIL_BYTES; ; window *= 4) {
      const start = Math.max(0, size - window);
      const chunk = await this.read(start, size);
      if (!chunk) return;
      // Starting mid-file lands inside a line; drop that fragment.
      const bytes = start > 0 ? chunk.subarray(chunk.indexOf(NEWLINE) + 1) : chunk;
      const state = this.apply(emptyTranscriptState(), bytes, now);
      const enough = state.prompt !== null && state.steps.length >= ENOUGH_STEPS;
      if (enough || start === 0 || window >= MAX_FIRST_LOOK_BYTES) {
        this.state = state;
        this.offset = start + chunk.length;
        return;
      }
    }
  }

  /** Applies every complete line and keeps the unfinished tail for next time. */
  private apply(state: TranscriptState, bytes: Buffer, now: number): TranscriptState {
    const lastNewline = bytes.lastIndexOf(NEWLINE);
    this.remainder = Buffer.from(bytes.subarray(lastNewline + 1));
    if (lastNewline < 0) return state;
    let next = state;
    for (const line of bytes.subarray(0, lastNewline).toString('utf8').split('\n')) {
      next = applyTranscriptLine(next, line, now);
    }
    return next;
  }

  private reset(): void {
    this.offset = -1;
    this.remainder = Buffer.alloc(0);
    this.state = emptyTranscriptState();
  }

  private async read(start: number, end: number): Promise<Buffer | null> {
    try {
      const handle = await open(this.path, 'r');
      try {
        const buffer = Buffer.alloc(end - start);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }
}
