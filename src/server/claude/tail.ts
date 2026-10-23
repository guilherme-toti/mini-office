import { open, stat } from 'node:fs/promises';
import { applyTranscriptLine, emptyTranscriptState, type TranscriptState } from './transcript.ts';

/** How much of an existing transcript is read on first sight: enough for the current turn. */
const INITIAL_TAIL_BYTES = 512 * 1024;
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

    const firstLook = this.offset < 0;
    const start = firstLook ? Math.max(0, size - INITIAL_TAIL_BYTES) : this.offset;
    const chunk = await this.read(start, size);
    if (!chunk) return;

    let bytes = Buffer.concat([this.remainder, chunk]);
    // Starting mid-file lands inside a line; drop that fragment.
    if (firstLook && start > 0) bytes = bytes.subarray(bytes.indexOf(NEWLINE) + 1);
    const lastNewline = bytes.lastIndexOf(NEWLINE);
    this.remainder = Buffer.from(bytes.subarray(lastNewline + 1));
    this.offset = start + chunk.length;
    if (lastNewline < 0) return;
    for (const line of bytes.subarray(0, lastNewline).toString('utf8').split('\n')) {
      this.state = applyTranscriptLine(this.state, line, now);
    }
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
