import type { Worker, WorkerDispatcher, WorkerFunction } from "./types";

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
    options: { functions: WorkerFunction[] }
  ) => { POST: (request: Request) => Promise<Response> };
} {
  return {
    async dispatch(data, options) {
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
      const { process } = worker.mount(options);

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

export function createQStashDispatcher({
  mountUrl,
  token,
  retries = 3,
}: {
  mountUrl: string;
  token: string;
  retries?: number;
}): WorkerDispatcher<{ retries: number }> & {
  mount: (
    worker: Worker<any>,
    options: { functions: WorkerFunction[] }
  ) => { POST: (request: Request) => Promise<Response> };
} {
  const fetchDispatcher = createDangerousFetchDispatcher({ mountUrl });

  return {
    async dispatch(data, options) {
      const unsupportedTypescriptRequestInitOptions = {
        duplex: "half",
      } as unknown as RequestInit;

      const res = await fetch(
        `https://qstash.upstash.io/v2/publish/${mountUrl}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Upstash-Method": "POST",
            "Upstash-Retries": `${options?.retries || retries}`,
          },
          body: data,
          ...unsupportedTypescriptRequestInitOptions,
        }
      );

      // Consume the body
      const respText = await res.text();

      if (!res.ok) {
        throw new Error(
          `Failed to dispatch using QStash: ${res.status} ${
            res.statusText
          } ${respText.slice(0, 1000)}`
        );
      }
    },

    mount: fetchDispatcher.mount,
  };
}
