import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Runner, STOP_TIMEOUT_MS } from '../src/runner';
import { WorkerLoop } from '../src/worker/loop';
import type { FromWorker, RunEnded, ToWorker } from '../src/worker/protocol';
import { Queue } from './queue';

/** A stand-in for a Worker: it records what it is sent, and the test answers for it. */
class FakeWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly sent: ToWorker[] = [];
  terminated = false;

  postMessage(message: ToWorker): void {
    this.sent.push(structuredClone(message));
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }

  crash(): void {
    this.onerror?.({} as ErrorEvent);
  }
}

/** A Worker running the real Worker loop, with both directions through one task queue. */
class LoopWorker extends FakeWorker {
  readonly queue = new Queue();
  readonly #loop = new WorkerLoop({
    post: (message) => this.queue.schedule(() => this.answer(structuredClone(message))),
    schedule: this.queue.schedule,
    slice: 1000,
  });

  override postMessage(message: ToWorker): void {
    super.postMessage(message);
    const copy = structuredClone(message);
    this.queue.schedule(() => this.#loop.handle(copy));
  }
}

function setup<W extends FakeWorker>(create: () => W) {
  const workers: W[] = [];
  const runner = new Runner(() => {
    const worker = create();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const output: string[] = [];
  const ended: RunEnded[] = [];
  const start = (text = 'int main(void) { return 0; }') =>
    runner.run([{ name: 'main.c', text }], {
      output: (t) => output.push(t),
      ended: (e) => ended.push(e),
    });
  return { runner, workers, output, ended, start };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Runner over the Worker loop', () => {
  it('runs a program and reports its output and end', () => {
    const { workers, output, ended, start, runner } = setup(() => new LoopWorker());
    start('#include <stdio.h>\nint main(void) { puts("hi"); return 2; }\n');
    expect(runner.running).toBe(true);
    workers[0]?.queue.run();
    expect(output.join('')).toBe('hi\n');
    expect(ended).toEqual([{ reason: 'exit', status: 2 }]);
    expect(runner.running).toBe(false);
  });

  it('stops an infinite loop', () => {
    const { workers, output, ended, start, runner } = setup(() => new LoopWorker());
    start("#include <stdio.h>\nint main(void) { for (;;) putchar('.'); }\n");
    const worker = workers[0] as LoopWorker;
    worker.queue.run(10);
    runner.stop();
    worker.queue.run();
    expect(ended).toEqual([{ reason: 'stopped' }]);
    expect(output.join('')).toMatch(/^\.+$/);
    expect(worker.terminated).toBe(false);
    vi.advanceTimersByTime(STOP_TIMEOUT_MS * 2);
    expect(ended).toHaveLength(1);
    // The same Worker takes the next run.
    start();
    worker.queue.run();
    expect(ended).toEqual([{ reason: 'stopped' }, { reason: 'exit', status: 0 }]);
    expect(workers).toHaveLength(1);
  });
});

describe('Runner', () => {
  it('creates its Worker at once and numbers each run', () => {
    const { workers, start } = setup(() => new FakeWorker());
    expect(workers).toHaveLength(1);
    start();
    const worker = workers[0] as FakeWorker;
    worker.answer({ type: 'ended', runId: 1, reason: 'exit', status: 0 });
    start();
    expect(worker.sent.map((m) => [m.type, m.runId])).toEqual([
      ['run', 1],
      ['run', 2],
    ]);
  });

  it('allows one run at a time', () => {
    const { start } = setup(() => new FakeWorker());
    start();
    expect(() => start()).toThrow('a run is active');
  });

  it('drops messages of another run', () => {
    const { workers, output, ended, start } = setup(() => new FakeWorker());
    start();
    const worker = workers[0] as FakeWorker;
    worker.answer({ type: 'output', runId: 0, text: 'late' });
    worker.answer({ type: 'ended', runId: 0, reason: 'stopped' });
    worker.answer({ type: 'output', runId: 1, text: 'mine' });
    expect(output).toEqual(['mine']);
    expect(ended).toEqual([]);
  });

  it('sends one stop, and past the timeout terminates the Worker and ends the run', () => {
    const { workers, ended, start, runner } = setup(() => new FakeWorker());
    start();
    runner.stop();
    runner.stop();
    const worker = workers[0] as FakeWorker;
    expect(worker.sent.filter((m) => m.type === 'stop')).toEqual([{ type: 'stop', runId: 1 }]);
    vi.advanceTimersByTime(STOP_TIMEOUT_MS - 1);
    expect(ended).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended).toEqual([{ reason: 'stopped' }]);
    expect(worker.terminated).toBe(true);
    // A late message from the terminated Worker is dropped; the next run gets a new Worker.
    worker.answer({ type: 'ended', runId: 1, reason: 'stopped' });
    expect(ended).toHaveLength(1);
    expect(workers).toHaveLength(1);
    start();
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent).toEqual([
      { type: 'run', runId: 2, files: [{ name: 'main.c', text: 'int main(void) { return 0; }' }] },
    ]);
  });

  it('ends the active run with engine.internal when the Worker fails, and replaces it on the next run', () => {
    const { workers, ended, start } = setup(() => new FakeWorker());
    start();
    const worker = workers[0] as FakeWorker;
    worker.crash();
    expect(ended).toEqual([
      { reason: 'diagnostic', diagnostic: { code: 'engine.internal', args: {} } },
    ]);
    expect(worker.terminated).toBe(true);
    expect(workers).toHaveLength(1);
    start();
    expect(workers).toHaveLength(2);
  });

  it('discards a Worker that fails with no run active', () => {
    const { workers, ended } = setup(() => new FakeWorker());
    workers[0]?.crash();
    expect(workers[0]?.terminated).toBe(true);
    expect(ended).toEqual([]);
    expect(workers).toHaveLength(1);
  });

  it('reports the real end when it crosses a stop, and keeps the Worker', () => {
    const { workers, output, ended, start, runner } = setup(() => new FakeWorker());
    start();
    runner.stop();
    const worker = workers[0] as FakeWorker;
    worker.answer({ type: 'output', runId: 1, text: 'in flight' });
    worker.answer({ type: 'ended', runId: 1, reason: 'exit', status: 9 });
    vi.advanceTimersByTime(STOP_TIMEOUT_MS * 2);
    expect(output).toEqual(['in flight']);
    expect(ended).toEqual([{ reason: 'exit', status: 9 }]);
    expect(worker.terminated).toBe(false);
    worker.answer({ type: 'output', runId: 1, text: 'late' });
    expect(output).toEqual(['in flight']);
  });

  it('ends a stopping run once when the Worker crashes during the stop', () => {
    const { workers, ended, start, runner } = setup(() => new FakeWorker());
    start();
    runner.stop();
    workers[0]?.crash();
    vi.advanceTimersByTime(STOP_TIMEOUT_MS * 2);
    expect(ended).toEqual([
      { reason: 'diagnostic', diagnostic: { code: 'engine.internal', args: {} } },
    ]);
    start();
    expect(workers).toHaveLength(2);
  });

  it('does nothing on a stop with no run, and replaces an idle crashed Worker on the next run', () => {
    const { workers, start, runner } = setup(() => new FakeWorker());
    runner.stop();
    expect(workers[0]?.sent).toEqual([]);
    workers[0]?.crash();
    start();
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent.map((m) => m.type)).toEqual(['run']);
  });
});
