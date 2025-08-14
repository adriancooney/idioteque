import type { Worker, WorkerDispatcher, WorkerMountOptions } from "./types";

/**
 * This dispatcher is dangerous because it does not guarantee delivery. If this
 * request fails, the event may not have been delivered and processing will halt.
 */
export function createDangerousFetchDispatcher({
  mountUrl,
}: {
  mountUrl: string;
}): WorkerDispatcher & {
  mount: (
    worker: Worker<any>,
    options: WorkerMountOptions
  ) => { POST: (request: Request) => Promise<Response> };
} {
  return {
    async dispatch(data) {
      const controller = new AbortController();

      const res = await fetch(mountUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        signal: controller.signal,
        // @ts-expect-error
        cache: "no-store",
        body: data,
      });

      res.body?.cancel();
    },

    mount(worker, options) {
      const { process } = worker.mount({
        ...options,
      });

      return {
        POST: async (request: Request) => {
          try {
            const data = await request.text();
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode("ACK"));

                process(data)
                  .then(() => {
                    controller.enqueue(encoder.encode("DONE"));
                    controller.close();
                  })
                  .catch((err) => controller.error(err));
              },
            });

            return new Response(stream, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          } catch (err) {
            return new Response("ERR", {
              status: 500,
            });
          }
        },
      };
    },
  };
}
