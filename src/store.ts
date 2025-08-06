import fs from "node:fs/promises";
import path from "node:path";
import type { WorkerStore } from "./types";

interface RedisImpl {
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

export function createRedisWorkerStore(redis: RedisImpl): WorkerStore {
  return {
    async getExecutionTaskResult(executionId, taskId) {
      const result = await redis.hget(`${executionId}-results`, taskId);

      if (typeof result === "string") {
        return JSON.parse(result);
      }

      return undefined;
    },
    async isExecutionTaskInProgress(executionId, taskId) {
      return Boolean(await redis.hget(`${executionId}-transactions`, taskId));
    },
    async beginExecutionTask(executionId, taskId) {
      await redis.hset(`${executionId}-transactions`, { [taskId]: "true" });
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
        redis.del(`${executionId}-transactions`),
        redis.del(`${executionId}-results`),
      ]);
    },
  };
}

export function createDangerousMemoryWorkerStore(): WorkerStore {
  const store: Record<
    string,
    Record<string, { value?: any; transaction?: boolean }>
  > = {};

  return {
    async getExecutionTaskResult(executionId, taskId) {
      return store[executionId]?.[taskId]?.value;
    },
    async isExecutionTaskInProgress(executionId, taskId) {
      return store[executionId]?.[taskId]?.value;
    },
    async beginExecutionTask(executionId, taskId) {
      store[executionId] ??= {};
      store[executionId][taskId] = { transaction: true };
    },
    async commitExecutionTaskResult(executionId, taskId, value) {
      store[executionId][taskId] = { value };
    },
    async disposeExecution(executionId) {
      delete store[executionId];
    },
  };
}

export function createFileSystemWorkerStore(storeDir: string): WorkerStore {
  const getExecutionDir = (executionId: string) =>
    path.join(storeDir, executionId);

  const getTransactionFile = (executionId: string, taskId: string) =>
    path.join(getExecutionDir(executionId), `${taskId}.transaction`);

  const getResultFile = (executionId: string, taskId: string) =>
    path.join(getExecutionDir(executionId), `${taskId}.result`);

  return {
    async getExecutionTaskResult(executionId, taskId) {
      try {
        const data = await fs.readFile(
          getResultFile(executionId, taskId),
          "utf-8"
        );
        return JSON.parse(data);
      } catch {
        return undefined;
      }
    },

    async isExecutionTaskInProgress(executionId, taskId) {
      try {
        await fs.access(getTransactionFile(executionId, taskId));
        return true;
      } catch {
        return false;
      }
    },

    async beginExecutionTask(executionId, taskId) {
      await fs.mkdir(getExecutionDir(executionId), { recursive: true });
      await fs.writeFile(getTransactionFile(executionId, taskId), "");
    },

    async commitExecutionTaskResult(executionId, taskId, value) {
      await fs.writeFile(
        getResultFile(executionId, taskId),
        JSON.stringify(value)
      );

      await fs.unlink(getTransactionFile(executionId, taskId)).catch(() => {});
    },

    async disposeExecution(executionId) {
      await fs
        .rm(getExecutionDir(executionId), { recursive: true, force: true })
        .catch(() => {});
    },
  };
}
