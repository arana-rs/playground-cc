import { Run } from 'engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerLoop } from '../src/worker/loop';
import type { FromWorker } from '../src/worker/protocol';
import { Queue } from './queue';

function setup(slice?: number) {
  const queue = new Queue();
  const messages: FromWorker[] = [];
  const reported: unknown[] = [];
  const loop = new WorkerLoop({
    post: (message) => messages.push(message),
    schedule: queue.schedule,
    report: (error) => reported.push(error),
    ...(slice !== undefined && { slice }),
  });
  const run = (runId: number, text: string) =>
    loop.handle({ type: 'run', runId, files: [{ name: 'main.c', text }] });
  return { queue, messages, reported, loop, run };
}

const program = (body: string) => `#include <stdio.h>\nint main(void) {\n${body}\n}\n`;
const text = (messages: FromWorker[]) =>
  messages.map((m) => (m.type === 'output' ? m.text : '')).join('');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WorkerLoop', () => {
  it('runs a program in slices and ends it with its status', () => {
    const { queue, messages, run } = setup();
    run(1, program('printf("Hello, %s!\\n", "world"); return 3;'));
    expect(messages).toEqual([]);
    queue.run();
    expect(messages).toEqual([
      { type: 'output', runId: 1, text: 'Hello, world!\n' },
      { type: 'ended', runId: 1, reason: 'exit', status: 3 },
    ]);
  });

  it('sends output once per slice, and yields between slices', () => {
    const { queue, messages, run } = setup(40);
    run(1, program("for (int i = 0; i < 20; i++) putchar('a' + i);"));
    queue.run(1);
    expect(queue.size).toBe(1);
    queue.run();
    const outputs = messages.filter((m) => m.type === 'output');
    expect(outputs.length).toBeGreaterThan(2);
    expect(text(messages)).toBe('abcdefghijklmnopqrst');
    expect(messages.at(-1)).toEqual({ type: 'ended', runId: 1, reason: 'exit', status: 0 });
  });

  it('decodes UTF-8 as a stream: a character split across slices arrives whole', () => {
    const { queue, messages, run } = setup(1);
    run(1, program('puts("ñandú 😀");'));
    queue.run();
    for (const message of messages)
      if (message.type === 'output') {
        expect(message.text).not.toContain('�');
      }
    expect(text(messages)).toBe('ñandú 😀\n');
  });

  it('turns invalid bytes, and an incomplete character at the end, into U+FFFD', () => {
    const { queue, messages, run } = setup();
    run(1, program("putchar(255); putchar('x'); putchar(0xE2); putchar(0x82);"));
    queue.run();
    expect(messages).toEqual([
      { type: 'output', runId: 1, text: '\uFFFDx\uFFFD' },
      { type: 'ended', runId: 1, reason: 'exit', status: 0 },
    ]);
  });

  it('ends a run with its diagnostic after the output before it', () => {
    const { queue, messages, run } = setup();
    run(1, program('int zero = 0;\nputs("before");\nreturn 1 / zero;'));
    queue.run();
    expect(messages[0]).toEqual({ type: 'output', runId: 1, text: 'before\n' });
    expect(messages[1]).toMatchObject({
      type: 'ended',
      runId: 1,
      reason: 'diagnostic',
      diagnostic: { code: 'ub.division_by_zero' },
    });
  });

  it('stops an infinite loop between two slices', () => {
    const { queue, messages, run, loop } = setup(1000);
    run(7, program("for (;;) { putchar('.'); }"));
    queue.run(5);
    loop.handle({ type: 'stop', runId: 6 });
    queue.run(5);
    expect(messages.some((m) => m.type === 'ended')).toBe(false);
    loop.handle({ type: 'stop', runId: 7 });
    expect(messages.at(-1)).toEqual({ type: 'ended', runId: 7, reason: 'stopped' });
    const count = messages.length;
    queue.run();
    expect(messages.length).toBe(count);
    expect(text(messages)).toMatch(/^\.+$/);
  });

  it('ends the run with engine.internal when the engine throws, and stays usable', () => {
    const { queue, messages, reported, run } = setup();
    const bug = new Error('a bug');
    const advance = vi.spyOn(Run.prototype, 'advance').mockImplementationOnce(() => {
      throw bug;
    });
    run(1, program('return 0;'));
    queue.run();
    expect(messages).toEqual([
      {
        type: 'ended',
        runId: 1,
        reason: 'diagnostic',
        diagnostic: { code: 'engine.internal', args: {} },
      },
    ]);
    expect(reported).toEqual([bug]);
    advance.mockRestore();
    run(2, program('return 5;'));
    queue.run();
    expect(messages.at(-1)).toEqual({ type: 'ended', runId: 2, reason: 'exit', status: 5 });
  });

  it('stops a run before its first slice, and drops a stop that crossed its ended', () => {
    const { queue, messages, run, loop } = setup();
    run(1, program('return 0;'));
    loop.handle({ type: 'stop', runId: 1 });
    queue.run();
    expect(messages).toEqual([{ type: 'ended', runId: 1, reason: 'stopped' }]);
    run(2, program('return 4;'));
    queue.run();
    loop.handle({ type: 'stop', runId: 2 });
    expect(messages.slice(1)).toEqual([{ type: 'ended', runId: 2, reason: 'exit', status: 4 }]);
  });

  it('flushes an incomplete character as U+FFFD when stopped', () => {
    const { queue, messages, run, loop } = setup(3);
    run(1, program('putchar(0xC3); for (;;) {}'));
    queue.run(20);
    loop.handle({ type: 'stop', runId: 1 });
    expect(messages).toEqual([
      { type: 'output', runId: 1, text: '�' },
      { type: 'ended', runId: 1, reason: 'stopped' },
    ]);
  });

  it('keeps the output a failing slice wrote before the engine threw', () => {
    const { queue, messages, run } = setup();
    const advance = Run.prototype.advance;
    vi.spyOn(Run.prototype, 'advance').mockImplementationOnce(function (this: Run, steps) {
      advance.call(this, steps);
      throw new Error('a bug after the output');
    });
    run(1, program('puts("written");'));
    queue.run();
    expect(messages).toEqual([
      { type: 'output', runId: 1, text: 'written\n' },
      {
        type: 'ended',
        runId: 1,
        reason: 'diagnostic',
        diagnostic: { code: 'engine.internal', args: {} },
      },
    ]);
  });

  it('ends with engine.internal when a run cannot be created, and stops the run it replaced', () => {
    const { queue, messages, run, loop } = setup(10);
    run(1, program('for (;;) {}'));
    queue.run(2);
    // Files that are not an array make the engine throw.
    loop.handle({ type: 'run', runId: 2, files: null as never });
    queue.run();
    expect(messages).toEqual([
      {
        type: 'ended',
        runId: 2,
        reason: 'diagnostic',
        diagnostic: { code: 'engine.internal', args: {} },
      },
    ]);
  });
});
