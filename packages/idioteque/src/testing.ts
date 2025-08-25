import { createMemoryStore } from "./store";
import type {
  Worker,
  WorkerFunction,
  WorkerMount,
  WorkerOptions,
} from "./types";

export function setupWorker<T extends { type: string }>(
  worker: Worker<T>,
  functions: WorkerFunction[]
) {
  let mount: WorkerMount<T>;
  let _workerOptions: WorkerOptions<T>;

  beforeAll(() => {
    _workerOptions = worker.getOptions();
    mount = worker.mount({ functions });
    worker.configure({
      store: createMemoryStore(),
      dispatcher: {
        async dispatch(data) {
          await mount.process(data);
        },
      },
    });
  });

  afterAll(() => {
    worker.configure(_workerOptions);
  });
}
