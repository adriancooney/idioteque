import {
  type Worker,
  type WorkerDispatcher,
  type WorkerEvent,
  type WorkerMountOptions,
  createDangerousFetchDispatcher,
} from "idioteque";

export function createQStashDispatcher({
  mountUrl,
  token,
  retries = 3,
}: {
  mountUrl: string;
  token: string;
  retries?: number;
}): WorkerDispatcher<{ retries: number }> & {
  mount: <T extends WorkerEvent>(
    worker: Worker<T>,
    options: WorkerMountOptions
  ) => { POST: (request: Request) => Promise<Response> };
} {
  // It's not dangerous in this context because QStash guarantees delivery
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

    mount<T extends WorkerEvent>(
      worker: Worker<T>,
      options: WorkerMountOptions
    ) {
      return fetchDispatcher.mount(worker, options);
    },
  };
}
