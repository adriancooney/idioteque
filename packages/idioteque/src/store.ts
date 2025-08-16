import fs from "node:fs/promises";
import path from "node:path";
import type { WorkerStore } from "./types";

export type MemoryStoreState = Record<
  string,
  Record<string, { value?: any; transaction?: boolean }>
>;

export type MemoryStore = WorkerStore & {
  getState: () => MemoryStoreState;
  setState: (state: MemoryStoreState) => void;
  clear: () => void;
};

export function createMemoryStore(): MemoryStore {
  let store: MemoryStoreState = {};

  return {
    async beginExecution(executionId) {
      store[executionId] = {};
    },
    async getExecutionTaskResults(executionId) {
      return Object.fromEntries(
        Object.entries(store[executionId] || {})
          .filter(
            (entry): entry is [key: string, value: { value: unknown }] =>
              entry[1].value
          )
          .map(([key, entry]) => [key, entry.value])
      );
    },
    async getExecutionTaskResult(executionId, taskId) {
      return store[executionId]?.[taskId]?.value;
    },
    async isExecutionInProgress(executionId) {
      return !!store[executionId] || false;
    },
    async isExecutionTaskInProgress(executionId, taskId) {
      return store[executionId]?.[taskId]?.transaction || false;
    },
    async beginExecutionTask(executionId, taskId) {
      store[executionId][taskId] = { transaction: true };
    },
    async commitExecutionTaskResult(executionId, taskId, value) {
      store[executionId][taskId] = { value };
    },
    async disposeExecution(executionId) {
      if (!store[executionId]) {
        throw new Error(`Execution '${executionId}' not found, cannot dispose`);
      }

      delete store[executionId];
    },
    getState() {
      return store;
    },
    setState(nextStore) {
      store = nextStore;
    },
    clear() {
      store = {};
    },
  };
}

export function createFileSystemStore(storeDir: string): WorkerStore {
  const getExecutionDir = (executionId: string) =>
    path.join(storeDir, executionId);

  const getTransactionFile = (executionId: string, taskId: string) =>
    path.join(getExecutionDir(executionId), `${taskId}.transaction`);

  const getResultFile = (executionId: string, taskId: string) =>
    path.join(getExecutionDir(executionId), `${taskId}.result`);

  return {
    async beginExecution(executionId) {
      await fs.mkdir(getExecutionDir(executionId), { recursive: true });
    },

    async getExecutionTaskResult(executionId, taskId) {
      try {
        const data = await fs.readFile(
          getResultFile(executionId, taskId),
          "utf-8"
        );

        return JSON.parse(data);
      } catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") {
          return undefined;
        }

        throw err;
      }
    },

    async isExecutionInProgress(executionId) {
      try {
        await fs.access(getExecutionDir(executionId));

        return true;
      } catch {
        return false;
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
      await fs.writeFile(getTransactionFile(executionId, taskId), "");
    },

    async commitExecutionTaskResult(executionId, taskId, value) {
      await fs.writeFile(
        getResultFile(executionId, taskId),
        JSON.stringify(value)
      );

      await fs.unlink(getTransactionFile(executionId, taskId));
    },

    async disposeExecution(executionId) {
      await fs.rm(getExecutionDir(executionId), {
        recursive: true,
        force: true,
      });
    },
  };
}
