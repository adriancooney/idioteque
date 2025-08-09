import { WorkerError } from "./errors";
import { type WorkerDispatcher, WorkerErrorResponse } from "./types";
import { jsonString } from "./util";

const errorResponse = jsonString.pipe(WorkerErrorResponse);

/**
 * This dispatcher is dangerous because it does not guarantee delivery. If this
 * request fails, the event may not have been delivered and processing will halt.
 */
export function createDangerousFetchDispatcher(sync = false): WorkerDispatcher {
  return {
    async send(request: Request) {
      const controller = new AbortController();

      try {
        const res = await fetch(request, {
          signal: controller.signal,
          // @ts-expect-error
          cache: "no-store",
        });

        let respText: string | null = null;

        if (sync) {
          respText = await res.text();
        }

        if (!res.ok) {
          respText = respText || (await res.text());

          const result = errorResponse.safeParse(respText);

          if (result.success) {
            const error = new WorkerError(result.data.message);
            error.stack = result.data.stack;
            throw error;
          }

          throw new WorkerError(
            `Failed to publish event to ${request.url}: ${res.status} ${res.statusText} ${respText}`
          );
        }
      } finally {
        controller.abort();
      }
    },

    async receive(request, options) {
      return await request.json();
    },
  };
}

/**
 * Dispatched used in testing. It waits for the execution to complete.
 */
export const createDangerousFetchSyncDispatcher = () =>
  createDangerousFetchDispatcher(true);

export function createQStashDispatcher({
  token,
  retries = 3,
}: {
  token: string;
  retries?: number;
}): WorkerDispatcher<{ retries: number }> {
  return {
    async send(request, options) {
      const unsupportedTypescriptRequestInitOptions = {
        duplex: "half",
      } as unknown as RequestInit;

      const res = await fetch(
        `https://qstash.upstash.io/v2/publish/${request.url}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Upstash-Method": "POST",
            "Upstash-Retries": `${options?.retries || retries}`,
          },
          body: request.body,
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

    async receive(request, options) {
      return await request.json();
    },
  };
}

export function createVercelQueueDispatcher(): WorkerDispatcher {
  return {
    async send(request) {
      return;
    },

    async receive(request) {
      return;
    },
  };
}
