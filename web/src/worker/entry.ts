// The Worker entry: the Worker loop over `postMessage` (design/worker-protocol.md).
import { WorkerLoop } from './loop';
import type { FromWorker, ToWorker } from './protocol';

// A message on a channel of its own yields to the event loop without the clamping of nested
// `setTimeout`, so a `stop` waiting in the queue runs before the next slice.
const tasks: (() => void)[] = [];
const channel = new MessageChannel();
channel.port1.onmessage = () => tasks.shift()?.();

const loop = new WorkerLoop({
  post: (message: FromWorker) => self.postMessage(message),
  schedule: (task) => {
    tasks.push(task);
    channel.port2.postMessage(null);
  },
  report: (error) => console.error(error),
});

self.onmessage = (event: MessageEvent<ToWorker>) => loop.handle(event.data);
