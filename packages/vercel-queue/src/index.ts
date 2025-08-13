import type {
  Worker,
  WorkerDispatcher,
  WorkerEvent,
  WorkerMountOptions,
} from "@belt/core";
import { handleCallback, send } from "@vercel/queue";

export function createVercelQueueDispatcher(): WorkerDispatcher & {
  mount: <T extends WorkerEvent>(
    worker: Worker<T>,
    options: WorkerMountOptions
  ) => ReturnType<typeof handleCallback>;
} {
  return {
    async dispatch(data) {
      await send("belt-message", { data });
    },

    mount<T extends WorkerEvent>(
      worker: Worker<T>,
      options: WorkerMountOptions
    ) {
      const { process } = worker.mount(options);

      return handleCallback({
        "belt-message": {
          worker: (message: any) => process(message.data),
        },
      });
    },
  };
}
