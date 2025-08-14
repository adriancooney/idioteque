import type { WorkerStore } from "idioteque";
import { Redis } from "ioredis";
import { createRedisStore } from "./store";

describe(createRedisStore, () => {
  let redis: Redis;
  let store: WorkerStore;

  beforeAll(async () => {
    redis = new Redis({
      host: "localhost",
      port: 6379,
    });

    try {
      await redis.ping();
    } catch (error) {
      throw new Error("Redis not available, skipping integration tests");
    }
  });

  beforeEach(() => {
    store = createRedisStore(redis);
  });

  afterEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await redis.disconnect();
  });

  describe("beginExecution", () => {
    it("should set execution key in Redis", async () => {
      const executionId = "exec-1";
      await store.beginExecution(executionId);

      expect(await redis.get(executionId)).toBe("true");
    });
  });

  describe("isExecutionInProgress", () => {
    it("should return true when execution exists", async () => {
      const executionId = "exec-1";
      await redis.set(executionId, "true");

      expect(await store.isExecutionInProgress(executionId)).toBe(true);
    });

    it("should return false when execution does not exist", async () => {
      const executionId = "exec-nonexistent";
      expect(await store.isExecutionInProgress(executionId)).toBe(false);
    });
  });

  describe("beginExecutionTask", () => {
    it("should set task transaction in Redis hash", async () => {
      const executionId = "exec-1";
      await store.beginExecutionTask(executionId, "task-1");

      expect(await redis.hget(`${executionId}-transactions`, "task-1")).toBe(
        "true"
      );
    });
  });

  describe("isExecutionTaskInProgress", () => {
    it("should return true when task is in progress", async () => {
      const executionId = "exec-1";
      await redis.hset(`${executionId}-transactions`, { "task-1": "true" });

      expect(await store.isExecutionTaskInProgress(executionId, "task-1")).toBe(
        true
      );
    });

    it("should return false when task is not in progress", async () => {
      const executionId = "exec-1";
      expect(await store.isExecutionTaskInProgress(executionId, "task-1")).toBe(
        false
      );
    });
  });

  describe("commitExecutionTaskResult", () => {
    it("should delete transaction and store result", async () => {
      const executionId = "exec-1";
      const value = { message: "success", count: 42 };

      await redis.hset(`${executionId}-transactions`, { "task-1": "true" });

      await store.commitExecutionTaskResult(executionId, "task-1", value);

      expect(await redis.hexists(`${executionId}-transactions`, "task-1")).toBe(
        0
      );

      expect(
        JSON.parse((await redis.hget(`${executionId}-results`, "task-1"))!)
      ).toEqual(value);
    });

    it("should handle primitive values", async () => {
      const executionId = "exec-1";
      await store.commitExecutionTaskResult(
        executionId,
        "task-1",
        "simple string"
      );

      expect(
        JSON.parse((await redis.hget(`${executionId}-results`, "task-1"))!)
      ).toBe("simple string");
    });

    it("should handle null values", async () => {
      const executionId = "exec-1";
      await store.commitExecutionTaskResult(executionId, "task-1", null);

      expect(
        JSON.parse((await redis.hget(`${executionId}-results`, "task-1"))!)
      ).toBeNull();
    });
  });

  describe("getExecutionTaskResult", () => {
    it("should return parsed JSON result when result exists", async () => {
      const executionId = "exec-1";
      const value = { message: "success", count: 42 };
      await redis.hset(`${executionId}-results`, {
        "task-1": JSON.stringify(value),
      });

      expect(await store.getExecutionTaskResult(executionId, "task-1")).toEqual(
        value
      );
    });

    it("should return undefined when result does not exist", async () => {
      const executionId = "exec-1";
      expect(
        await store.getExecutionTaskResult(executionId, "task-1")
      ).toBeUndefined();
    });

    it("should handle primitive string values", async () => {
      const executionId = "exec-1";
      await redis.hset(`${executionId}-results`, {
        "task-1": JSON.stringify("simple string"),
      });

      expect(await store.getExecutionTaskResult(executionId, "task-1")).toBe(
        "simple string"
      );
    });

    it("should handle null values", async () => {
      const executionId = "exec-1";
      await redis.hset(`${executionId}-results`, {
        "task-1": JSON.stringify(null),
      });

      expect(
        await store.getExecutionTaskResult(executionId, "task-1")
      ).toBeNull();
    });
  });

  describe("disposeExecution", () => {
    it("should delete all execution-related keys", async () => {
      const executionId = "exec-1";

      await redis.set(executionId, "true");
      await redis.hset(`${executionId}-transactions`, { "task-1": "true" });
      await redis.hset(`${executionId}-results`, { "task-1": "result" });

      await store.disposeExecution(executionId);

      expect(await redis.exists(executionId)).toBe(0);
      expect(await redis.exists(`${executionId}-transactions`)).toBe(0);
      expect(await redis.exists(`${executionId}-results`)).toBe(0);
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete task lifecycle", async () => {
      const executionId = "exec-1";

      await store.beginExecution(executionId);
      expect(await redis.get(executionId)).toBe("true");

      expect(await store.isExecutionInProgress(executionId)).toBe(true);

      await store.beginExecutionTask(executionId, "task-1");
      expect(await redis.hget(`${executionId}-transactions`, "task-1")).toBe(
        "true"
      );

      expect(await store.isExecutionTaskInProgress(executionId, "task-1")).toBe(
        true
      );

      const taskResult = { status: "completed", data: [1, 2, 3] };
      await store.commitExecutionTaskResult(executionId, "task-1", taskResult);

      expect(await store.isExecutionTaskInProgress(executionId, "task-1")).toBe(
        false
      );

      expect(await redis.hexists(`${executionId}-transactions`, "task-1")).toBe(
        0
      );

      expect(await store.getExecutionTaskResult(executionId, "task-1")).toEqual(
        taskResult
      );

      await store.disposeExecution(executionId);

      expect(await store.isExecutionInProgress(executionId)).toBe(false);

      expect(await redis.exists(executionId)).toBe(0);
      expect(await redis.exists(`${executionId}-transactions`)).toBe(0);
      expect(await redis.exists(`${executionId}-results`)).toBe(0);
    });

    it("should handle multiple tasks in same execution", async () => {
      const executionId = "exec-1";

      await store.beginExecution(executionId);

      await store.beginExecutionTask(executionId, "task-1");
      await store.beginExecutionTask(executionId, "task-2");

      expect(await redis.hget(`${executionId}-transactions`, "task-1")).toBe(
        "true"
      );
      expect(await redis.hget(`${executionId}-transactions`, "task-2")).toBe(
        "true"
      );

      await store.commitExecutionTaskResult(executionId, "task-1", "result-1");
      await store.commitExecutionTaskResult(executionId, "task-2", "result-2");

      expect(await redis.hexists(`${executionId}-transactions`, "task-1")).toBe(
        0
      );
      expect(await redis.hexists(`${executionId}-transactions`, "task-2")).toBe(
        0
      );

      expect(
        JSON.parse((await redis.hget(`${executionId}-results`, "task-1"))!)
      ).toBe("result-1");
      expect(
        JSON.parse((await redis.hget(`${executionId}-results`, "task-2"))!)
      ).toBe("result-2");
    });

    it("should handle concurrent operations", async () => {
      const executionId = "exec-1";

      await store.beginExecution(executionId);

      const tasks = ["task-1", "task-2", "task-3", "task-4", "task-5"];
      await Promise.all(
        tasks.map((taskId) => store.beginExecutionTask(executionId, taskId))
      );

      for (const taskId of tasks) {
        expect(await redis.hexists(`${executionId}-transactions`, taskId)).toBe(
          1
        );
      }

      await Promise.all(
        tasks.map((taskId) =>
          store.commitExecutionTaskResult(
            executionId,
            taskId,
            `result-${taskId}`
          )
        )
      );

      for (const taskId of tasks) {
        expect(await redis.hexists(`${executionId}-transactions`, taskId)).toBe(
          0
        );
        expect(await store.getExecutionTaskResult(executionId, taskId)).toBe(
          `result-${taskId}`
        );
      }
    });
  });
});
