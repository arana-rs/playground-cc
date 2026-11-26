/** A task queue the tests run by hand, standing in for the event loop. */
export class Queue {
  readonly #tasks: (() => void)[] = [];

  readonly schedule = (task: () => void): void => {
    this.#tasks.push(task);
  };

  get size(): number {
    return this.#tasks.length;
  }

  /** Runs up to `count` tasks, in order; the tasks they schedule run after the waiting ones. */
  run(count = Number.POSITIVE_INFINITY): void {
    for (let i = 0; i < count && this.#tasks.length > 0; i++) this.#tasks.shift()?.();
  }
}
