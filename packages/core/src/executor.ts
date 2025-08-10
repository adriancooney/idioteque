import type { WorkerExecutor } from "./types";

export const defaultExecutor = createExecutorWithRetries(0);

export function createExecutorWithRetries(retries: number): WorkerExecutor {
  return async (func, args, { logger, onError }) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await func.handler(...args);
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }

        logger?.error(`!! retrying worker run (attempt = ${attempt})`);
        onError?.(error);
      }
    }
  };
}
