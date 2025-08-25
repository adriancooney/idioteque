import type { WorkerStore } from "idioteque";

export interface RedisImpl {
  set(key: string, value: string): Promise<any>;
  get(key: string): Promise<unknown | null>;
  hset: (
    key: string,
    kv: {
      [field: string]: string;
    }
  ) => Promise<any>;
  hget: (key: string, field: string) => Promise<unknown | null>;
  hdel: (key: string, field: string) => Promise<any>;
  hgetall: (key: string) => Promise<Record<string, unknown> | string[] | null>; // Some clients returns [key, value, key, value, ...]
  del: (key: string) => Promise<any>;
  expire: (key: string, seconds: number) => Promise<any>;
}

export function createRedisStore(
  redis: RedisImpl,
  options: { ttl?: number } = {}
): WorkerStore {
  return {
    async beginExecution(executionId) {
      await redis.set(executionId, "true");

      if (options.ttl) {
        await redis.expire(executionId, Math.ceil(options.ttl / 1000));
      }
    },

    async getExecutionTaskResults(executionId) {
      let result = await redis.hgetall(`${executionId}-results`);

      if (!result) {
        return {};
      }

      if (Array.isArray(result)) {
        result = Object.fromEntries(pair(result));
      }

      return Object.fromEntries(
        Object.entries(result).map(([key, value]) => {
          try {
            return [key, JSON.parse(value as string)];
          } catch (error) {
            throw new Error(
              `Failed to parse JSON for Redis key "${executionId}-results" field "${key}": ${error instanceof Error ? error.message : String(error)}. Raw value: "${value}"`
            );
          }
        })
      );
    },

    async getExecutionTaskResult(executionId, taskId) {
      const result = await redis.hget(`${executionId}-results`, taskId);

      if (typeof result === "string") {
        try {
          return JSON.parse(result);
        } catch (error) {
          throw new Error(
            `Failed to parse JSON for Redis key "${executionId}-results" field "${taskId}": ${error instanceof Error ? error.message : String(error)}. Raw value: "${result}"`
          );
        }
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

      if (options.ttl) {
        await redis.expire(
          `${executionId}-transactions`,
          Math.ceil(options.ttl / 1000)
        );
      }
    },
    async commitExecutionTaskResult(executionId, taskId, value) {
      const operations = [
        redis.hdel(`${executionId}-transactions`, taskId),
        redis.hset(`${executionId}-results`, {
          [taskId]: JSON.stringify(value),
        }),
      ];

      if (options.ttl) {
        operations.push(
          redis.expire(`${executionId}-results`, Math.ceil(options.ttl / 1000))
        );
      }

      await Promise.all(operations);
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

function pair<T>(values: T[]): [T, T][] {
  return Array.from({ length: Math.floor(values.length / 2) }, (_, i) => [
    values[i * 2],
    values[i * 2 + 1],
  ]);
}
