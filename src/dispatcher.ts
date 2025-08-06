import { WorkerError } from "./errors";
import { type WorkerDispatcher, WorkerErrorResponse } from "./types";
import { jsonString } from "./util";

const errorResponse = jsonString.pipe(WorkerErrorResponse);

export const defaultDispatcher = (async (request: Request) => {
  const controller = new AbortController();

  const res = await fetch(request, {
    signal: controller.signal,
    // @ts-expect-error
    cache: "no-store",
  });

  if (!res.ok) {
    const respText = await res.text();
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
}) satisfies WorkerDispatcher;

export const syncDispatcher = (async (request: Request) => {
  const controller = new AbortController();

  try {
    const res = await fetch(request, {
      signal: controller.signal,
    });

    const respText = await res.text();

    if (!res.ok) {
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
}) satisfies WorkerDispatcher;

export function createQStashDispatcher({
  token,
  retries = 3,
}: {
  token: string;
  retries?: number;
}): WorkerDispatcher<{ retries: number }> {
  return async (request, options) => {
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
  };
}
