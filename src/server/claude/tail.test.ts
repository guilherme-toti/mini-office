import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptTail } from './tail.ts';

const line = (record: unknown) => `${JSON.stringify(record)}\n`;
const title = (text: string) => line({ type: 'ai-title', aiTitle: text });

describe('transcript tail', () => {
  let dir = '';
  let path = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mini-office-tail-'));
    path = join(dir, 'session.jsonl');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('applies only whole lines and picks up the rest on the next poll', async () => {
    const full = title('First');
    await writeFile(path, full.slice(0, 10));
    const tail = new TranscriptTail(path);
    await tail.poll(0);
    expect(tail.state.title).toBeNull();
    await appendFile(path, full.slice(10));
    await tail.poll(0);
    expect(tail.state.title).toBe('First');
  });

  it('keeps a multi-byte character whole when a write splits it', async () => {
    const full = Buffer.from(title('Café ☕'));
    const cut = full.indexOf(Buffer.from('☕')) + 1;
    await writeFile(path, full.subarray(0, cut));
    const tail = new TranscriptTail(path);
    await tail.poll(0);
    await appendFile(path, full.subarray(cut));
    await tail.poll(0);
    expect(tail.state.title).toBe('Café ☕');
  });

  it('starts over when the file is rewritten shorter', async () => {
    await writeFile(path, title('A long original title') + title('Second'));
    const tail = new TranscriptTail(path);
    await tail.poll(0);
    expect(tail.state.title).toBe('Second');
    await writeFile(path, title('New'));
    await tail.poll(0);
    expect(tail.state.title).toBe('New');
  });

  it('looks further back when huge tool output hides the latest request', async () => {
    const steps = Array.from({ length: 5 }, (_, index) =>
      line({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: `t${index}`, name: 'Read', input: {} }] },
      }),
    ).join('');
    const screenshot = line({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 't4', content: 'x'.repeat(900_000) }],
      },
    });
    const ask = line({ type: 'user', message: { content: 'Polish the dashboard' } });
    await writeFile(path, ask + steps + screenshot);
    const tail = new TranscriptTail(path);
    await tail.poll(0);
    expect(tail.state.prompt).toBe('Polish the dashboard');
    expect(tail.state.steps).toHaveLength(5);
  });

  it('ignores a missing file', async () => {
    const tail = new TranscriptTail(join(dir, 'nope.jsonl'));
    await expect(tail.poll(0)).resolves.toBeUndefined();
    expect(tail.state.phase).toBe('idle');
  });
});
