import type { WorkerDispatcher } from "@belt/core";
import { handleCallback, send } from "@vercel/queue";

export function createVercelQueueDispatcher(): WorkerDispatcher & {
  mount: () => void;
} {
  return {
    async dispatch(data) {
      await send("belt-message", { data });
    },

    async mount() {},
  };
}
