import { Redis as UpstashRedis } from "@upstash/redis";
import type { WorkerStore } from "idioteque";
import { Redis } from "ioredis";
import { type RedisImpl, createRedisStore } from "./";

type TestRedisImpl = RedisImpl & {
  hexists: (key: string, field: string) => Promise<number>;
  exists: (key: string) => Promise<number>;
  flushall: () => Promise<any>;
  ttl: (key: string) => Promise<number>;
  // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
  disconnect?: () => Promise<any> | void;
};

interface TestRedisClient {
  name: string;
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
  clear: () => Promise<void>;
  getClient: () => TestRedisImpl;
}

function createTestRedisClient<T extends TestRedisImpl>({
  name,
  setup,
  teardown,
  clear,
}: {
  name: string;
  setup: () => Promise<T>;
  teardown?: (client: T) => Promise<void>;
  clear: (client: T) => Promise<void>;
}): TestRedisClient {
  let client: T;

  return {
    name,
    setup: async () => {
      client = await setup();
    },
    getClient: () => client,
    clear: () => clear(client),
    teardown: async () => teardown?.(client),
  };
}

const testClients = [
  createTestRedisClient({
    name: "ioredis",
    async setup() {
      const ioredis = new Redis({
        host: "localhost",
        port: 6379,
      });

      await ioredis.ping();

      return ioredis;
    },
    async teardown(client) {
      await client.disconnect();
    },
    async clear(client) {
      await client.flushall();
    },
  }),
  createTestRedisClient({
    name: "upstash-redis-no-deserialization",
    async setup() {
      return new UpstashRedis({
        url: "http://localhost:8079",
        token: "your_token_here",
        automaticDeserialization: false,
      });
    },
    async clear(client) {
      await client.flushall();
    },
  }),
];

describe(createRedisStore, () => {
  describe.each(testClients)(
    "with $name client",
    ({ setup, teardown, clear, getClient }) => {
      let store: WorkerStore;

      beforeAll(async () => {
        await setup();
        store = createRedisStore(getClient());
      });

      afterAll(async () => {
        await teardown();
      });

      afterEach(async () => {
        await clear();
      });

      describe("beginExecution", () => {
        it("should set execution key in Redis", async () => {
          const executionId = "exec-1";
          await store.beginExecution(executionId);

          expect(await getClient().get(executionId)).toBe("true");
        });
      });

      describe("isExecutionInProgress", () => {
        it("should return true when execution exists", async () => {
          const executionId = "exec-1";
          await getClient().set(executionId, "true");

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

          expect(
            await getClient().hget(`${executionId}-transactions`, "task-1")
          ).toBe("true");
        });
      });

      describe("isExecutionTaskInProgress", () => {
        it("should return true when task is in progress", async () => {
          const executionId = "exec-1";
          await getClient().hset(`${executionId}-transactions`, {
            "task-1": "true",
          });

          expect(
            await store.isExecutionTaskInProgress(executionId, "task-1")
          ).toBe(true);
        });

        it("should return false when task is not in progress", async () => {
          const executionId = "exec-1";
          expect(
            await store.isExecutionTaskInProgress(executionId, "task-1")
          ).toBe(false);
        });
      });

      describe("commitExecutionTaskResult", () => {
        it("should delete transaction and store result", async () => {
          const executionId = "exec-1";
          const value = { message: "success", count: 42 };

          await getClient().hset(`${executionId}-transactions`, {
            "task-1": "true",
          });

          await store.commitExecutionTaskResult(executionId, "task-1", value);

          expect(
            await getClient().hexists(`${executionId}-transactions`, "task-1")
          ).toBe(0);

          expect(
            JSON.parse(
              (await getClient().hget(
                `${executionId}-results`,
                "task-1"
              )) as string
            )
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
            JSON.parse(
              (await getClient().hget(
                `${executionId}-results`,
                "task-1"
              )) as string
            )
          ).toBe("simple string");
        });

        it("should handle null values", async () => {
          const executionId = "exec-1";
          await store.commitExecutionTaskResult(executionId, "task-1", null);

          expect(
            JSON.parse(
              (await getClient().hget(
                `${executionId}-results`,
                "task-1"
              )) as string
            )
          ).toBeNull();
        });
      });

      describe("getExecutionTaskResult", () => {
        it("should return parsed JSON result when result exists", async () => {
          const executionId = "exec-1";
          const value = { message: "success", count: 42 };
          await getClient().hset(`${executionId}-results`, {
            "task-1": JSON.stringify(value),
          });

          expect(
            await store.getExecutionTaskResult(executionId, "task-1")
          ).toEqual(value);
        });

        it("should return undefined when result does not exist", async () => {
          const executionId = "exec-1";
          expect(
            await store.getExecutionTaskResult(executionId, "task-1")
          ).toBeUndefined();
        });

        it("should handle primitive string values", async () => {
          const executionId = "exec-1";
          await getClient().hset(`${executionId}-results`, {
            "task-1": JSON.stringify("simple string"),
          });

          expect(
            await store.getExecutionTaskResult(executionId, "task-1")
          ).toBe("simple string");
        });

        it("should handle null values", async () => {
          const executionId = "exec-1";
          await getClient().hset(`${executionId}-results`, {
            "task-1": JSON.stringify(null),
          });

          expect(
            await store.getExecutionTaskResult(executionId, "task-1")
          ).toBeNull();
        });
      });

      describe("getExecutionTaskResults", () => {
        it("should return all task results for an execution", async () => {
          const hash = {
            "task-1": JSON.stringify({ message: "success", count: 42 }),
            "task-2": JSON.stringify("simple string"),
            "task-3": JSON.stringify(null),
          };

          await getClient().hset("exec1-results", hash);

          const results = await store.getExecutionTaskResults?.("exec1");

          expect(results).toEqual({
            "task-1": { message: "success", count: 42 },
            "task-2": "simple string",
            "task-3": null,
          });
        });

        it("should return empty object when no results exist", async () => {
          const results =
            await store.getExecutionTaskResults?.("exec-nonexistent");

          expect(results).toEqual({});
        });
      });

      describe("disposeExecution", () => {
        it("should delete all execution-related keys", async () => {
          const executionId = "exec-1";

          await getClient().set(executionId, "true");
          await getClient().hset(`${executionId}-transactions`, {
            "task-1": "true",
          });
          await getClient().hset(`${executionId}-results`, {
            "task-1": "result",
          });

          await store.disposeExecution(executionId);

          expect(await getClient().exists(executionId)).toBe(0);
          expect(await getClient().exists(`${executionId}-transactions`)).toBe(
            0
          );
          expect(await getClient().exists(`${executionId}-results`)).toBe(0);
        });
      });

      describe("TTL functionality", () => {
        it("should set TTL on execution key when ttl option is provided", async () => {
          const ttl = 5000; // 5 seconds in ms
          const storeWithTTL = createRedisStore(getClient(), { ttl });
          const executionId = "exec-ttl";

          await storeWithTTL.beginExecution(executionId);

          // Check that the key exists
          expect(await getClient().get(executionId)).toBe("true");

          // Check that TTL is set (should be around 5 seconds, allowing some variance)
          const keyTTL = await getClient().ttl(executionId);
          expect(keyTTL).toBeGreaterThan(0);
          expect(keyTTL).toBeLessThanOrEqual(5);
        });

        it("should not set TTL when ttl option is not provided", async () => {
          const storeWithoutTTL = createRedisStore(getClient());
          const executionId = "exec-no-ttl";

          await storeWithoutTTL.beginExecution(executionId);

          // Check that the key exists
          expect(await getClient().get(executionId)).toBe("true");

          // Check that no TTL is set (-1 means no expiration)
          const keyTTL = await getClient().ttl(executionId);
          expect(keyTTL).toBe(-1);
        });

        it("should set TTL on transaction keys", async () => {
          const ttl = 3000; // 3 seconds in ms
          const storeWithTTL = createRedisStore(getClient(), { ttl });
          const executionId = "exec-transaction-ttl";

          await storeWithTTL.beginExecutionTask(executionId, "task-1");

          // Check that the transaction key exists
          expect(
            await getClient().hget(`${executionId}-transactions`, "task-1")
          ).toBe("true");

          // Check that TTL is set on the hash
          const keyTTL = await getClient().ttl(`${executionId}-transactions`);
          expect(keyTTL).toBeGreaterThan(0);
          expect(keyTTL).toBeLessThanOrEqual(3);
        });

        it("should set TTL on result keys", async () => {
          const ttl = 4000; // 4 seconds in ms
          const storeWithTTL = createRedisStore(getClient(), { ttl });
          const executionId = "exec-result-ttl";
          const taskResult = { data: "test" };

          await storeWithTTL.commitExecutionTaskResult(
            executionId,
            "task-1",
            taskResult
          );

          // Check that the result key exists
          const result = await getClient().hget(
            `${executionId}-results`,
            "task-1"
          );
          expect(JSON.parse(result as string)).toEqual(taskResult);

          // Check that TTL is set on the results hash
          const keyTTL = await getClient().ttl(`${executionId}-results`);
          expect(keyTTL).toBeGreaterThan(0);
          expect(keyTTL).toBeLessThanOrEqual(4);
        });

        it("should handle millisecond to second conversion correctly", async () => {
          const ttl = 2500; // 2.5 seconds in ms, should be rounded up to 3 seconds
          const storeWithTTL = createRedisStore(getClient(), { ttl });
          const executionId = "exec-conversion";

          await storeWithTTL.beginExecution(executionId);

          // Check that TTL is set to 3 seconds (rounded up from 2.5)
          const keyTTL = await getClient().ttl(executionId);
          expect(keyTTL).toBeGreaterThan(0);
          expect(keyTTL).toBeLessThanOrEqual(3);
        });
      });

      describe("integration scenarios", () => {
        it("should handle complete task lifecycle", async () => {
          const executionId = "exec-1";

          await store.beginExecution(executionId);
          expect(await getClient().get(executionId)).toBe("true");

          expect(await store.isExecutionInProgress(executionId)).toBe(true);

          await store.beginExecutionTask(executionId, "task-1");
          expect(
            await getClient().hget(`${executionId}-transactions`, "task-1")
          ).toBe("true");

          expect(
            await store.isExecutionTaskInProgress(executionId, "task-1")
          ).toBe(true);

          const taskResult = { status: "completed", data: [1, 2, 3] };
          await store.commitExecutionTaskResult(
            executionId,
            "task-1",
            taskResult
          );

          expect(
            await store.isExecutionTaskInProgress(executionId, "task-1")
          ).toBe(false);

          expect(
            await getClient().hexists(`${executionId}-transactions`, "task-1")
          ).toBe(0);

          expect(
            await store.getExecutionTaskResult(executionId, "task-1")
          ).toEqual(taskResult);

          await store.disposeExecution(executionId);

          expect(await store.isExecutionInProgress(executionId)).toBe(false);

          expect(await getClient().exists(executionId)).toBe(0);
          expect(await getClient().exists(`${executionId}-transactions`)).toBe(
            0
          );
          expect(await getClient().exists(`${executionId}-results`)).toBe(0);
        });

        it("should handle multiple tasks in same execution", async () => {
          const executionId = "exec-1";

          await store.beginExecution(executionId);

          await store.beginExecutionTask(executionId, "task-1");
          await store.beginExecutionTask(executionId, "task-2");

          expect(
            await getClient().hget(`${executionId}-transactions`, "task-1")
          ).toBe("true");
          expect(
            await getClient().hget(`${executionId}-transactions`, "task-2")
          ).toBe("true");

          await store.commitExecutionTaskResult(
            executionId,
            "task-1",
            "result-1"
          );
          await store.commitExecutionTaskResult(
            executionId,
            "task-2",
            "result-2"
          );

          expect(
            await getClient().hexists(`${executionId}-transactions`, "task-1")
          ).toBe(0);
          expect(
            await getClient().hexists(`${executionId}-transactions`, "task-2")
          ).toBe(0);

          expect(
            JSON.parse(
              (await getClient().hget(
                `${executionId}-results`,
                "task-1"
              )) as string
            )
          ).toBe("result-1");
          expect(
            JSON.parse(
              (await getClient().hget(
                `${executionId}-results`,
                "task-2"
              )) as string
            )
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
            expect(
              await getClient().hexists(`${executionId}-transactions`, taskId)
            ).toBe(1);
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
            expect(
              await getClient().hexists(`${executionId}-transactions`, taskId)
            ).toBe(0);
            expect(
              await store.getExecutionTaskResult(executionId, taskId)
            ).toBe(`result-${taskId}`);
          }

          const allResults =
            (await store.getExecutionTaskResults?.(executionId)) || {};
          expect(Object.keys(allResults)).toHaveLength(5);

          for (const taskId of tasks) {
            expect(allResults[taskId]).toBe(`result-${taskId}`);
          }
        });

        it("should use getExecutionTaskResults to retrieve all results at once", async () => {
          const executionId = "exec-1";

          await store.beginExecution(executionId);

          const taskResults = {
            "task-1": { type: "object", value: 123 },
            "task-2": "string result",
            "task-3": [1, 2, 3],
            "task-4": true,
            "task-5": null,
          };

          for (const [taskId, result] of Object.entries(taskResults)) {
            await store.beginExecutionTask(executionId, taskId);
            await store.commitExecutionTaskResult(executionId, taskId, result);
          }

          const allResults =
            (await store.getExecutionTaskResults?.(executionId)) || {};

          expect(Object.keys(allResults)).toHaveLength(5);
          expect(allResults).toEqual({
            "task-1": taskResults["task-1"],
            "task-2": taskResults["task-2"],
            "task-3": taskResults["task-3"],
            "task-4": taskResults["task-4"],
            "task-5": taskResults["task-5"],
          });

          for (const [taskId, expectedResult] of Object.entries(taskResults)) {
            expect(allResults[taskId]).toEqual(expectedResult);
          }
        });
      });
    }
  );
});
