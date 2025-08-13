import { handleCallback, send } from "@vercel/queue";
import type {
  Worker,
  WorkerDispatcher,
  WorkerEvent,
  WorkerMountOptions,
} from "idioteque";

export function createVercelQueueDispatcher(): WorkerDispatcher & {
  mount: <T extends WorkerEvent>(
    worker: Worker<T>,
    options: WorkerMountOptions
  ) => { POST: ReturnType<typeof handleCallback> };
} {
  return {
    async dispatch(data) {
      await send("idioteque-message", { data });
    },

    mount<T extends WorkerEvent>(
      worker: Worker<T>,
      options: WorkerMountOptions
    ) {
      const { process } = worker.mount(options);

      return {
        POST: handleCallback({
          "idioteque-message": {
            worker: (message: any) => process(message.data),
          },
        }),
      };
    },
  };
}
