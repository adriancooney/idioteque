import type { WorkerStore } from "idioteque";

interface RedisImpl {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<unknown>;
  hset: (
    key: string,
    kv: {
      [field: string]: string;
    }
  ) => Promise<number>;
  hget: (key: string, field: string) => Promise<unknown>;
  hdel: (key: string, field: string) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
}

export function createRedisStore(redis: RedisImpl): WorkerStore {
  return {
    async beginExecution(executionId) {
      await redis.set(executionId, "true");
    },
    async getExecutionTaskResult(executionId, taskId) {
      const result = await redis.hget(`${executionId}-results`, taskId);

      if (typeof result === "string") {
        return JSON.parse(result);
      }

      return undefined;
    },
    async isExecutionInProgress(executionId) {
      return Boolean(await redis.get(executionId));
    },
    async isExecutionTaskInProgress(executionId, taskId) {
      return Boolean(await redis.hget(`${executionId}-transactions`, taskId));
    },
    async beginExecutionTask(executionId, taskId) {
      await redis.hset(`${executionId}-transactions`, {
        [taskId]: "true",
      });
    },
    async commitExecutionTaskResult(executionId, taskId, value) {
      await Promise.all([
        redis.hdel(`${executionId}-transactions`, taskId),
        redis.hset(`${executionId}-results`, {
          [taskId]: JSON.stringify(value),
        }),
      ]);
    },
    async disposeExecution(executionId) {
      await Promise.all([
        redis.del(executionId),
        redis.del(`${executionId}-transactions`),
        redis.del(`${executionId}-results`),
      ]);
    },
  };
}
