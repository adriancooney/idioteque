import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { debugWorkerLogger } from "./logger";
import { type MemoryStore, createMemoryStore } from "./store";
import type { Worker, WorkerFunction, WorkerMount } from "./types";
import { createWorker } from "./worker";

type JestMockAny = jest.Mock<any, any, any>;

describe("worker", () => {
  let dispatcherMock: JestMockAny;
  let fooWorkerFunctionMock: JestMockAny;
  let barWorkerFunctionMock: JestMockAny;
  let worker: Worker<{ type: "foo" } | { type: "bar" }>;
  let workerMount: WorkerMount<{ type: "foo" } | { type: "bar" }>;
  const timestamp = 1755036557392;

  beforeEach(() => {
    dispatcherMock = jest.fn();
    fooWorkerFunctionMock = jest.fn();
    barWorkerFunctionMock = jest.fn();

    worker = createWorker({
      eventsSchema: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("foo"),
        }),
        z.object({
          type: z.literal("bar"),
        }),
      ]),
      store: createMemoryStore(),
      dispatcher: { dispatch: dispatcherMock },
      logger: debugWorkerLogger,
    });

    workerMount = worker.mount({
      functions: [
        worker.createFunction("func1", "foo", fooWorkerFunctionMock),
        worker.createFunction(
          "func2",
          (event): event is { type: "bar" } => event.type === "bar",
          barWorkerFunctionMock
        ),
      ],
      executionMode: "UNTIL_ERROR",
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Worker#publish", () => {
    it("publishes event", async () => {
      await worker.publish({
        type: "foo",
      });

      expect(dispatcherMock).toHaveBeenCalled();

      const req = dispatcherMock.mock.calls[0][0];
      expect(JSON.parse(req)).toEqual({
        event: {
          type: "foo",
        },
      });
    });

    it("sends options to dispatcher", async () => {
      await worker.publish(
        {
          type: "foo",
        },
        {
          retries: 1,
        }
      );

      expect(dispatcherMock).toHaveBeenCalledWith(expect.any(String), {
        retries: 1,
      });
    });
  });

  describe("with execute", () => {
    let aExecution1Mock: JestMockAny;
    let aExecution2Mock: JestMockAny;
    let aExecution2ErrorMock: JestMockAny;
    let aExecution3Mock: JestMockAny;
    let func1Mock: JestMockAny;

    let store: MemoryStore;
    let func1Function: WorkerFunction;

    beforeEach(() => {
      dispatcherMock = jest.fn();
      aExecution1Mock = jest.fn();
      aExecution2Mock = jest.fn();
      aExecution2ErrorMock = jest.fn();
      aExecution3Mock = jest.fn();
      func1Mock = jest.fn(async (event, { execute }) => {
        const aExecution1Result = await execute("astep1", aExecution1Mock);

        try {
          const aExecution2Result = await execute("astep2", () =>
            aExecution2Mock(aExecution1Result)
          );

          await aExecution3Mock(aExecution1Result, aExecution2Result);
        } catch (err) {
          aExecution2ErrorMock(err);
        }
      });

      store = createMemoryStore();

      worker = createWorker({
        eventsSchema: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("foo"),
          }),
          z.object({
            type: z.literal("bar"),
          }),
        ]),
        dispatcher: { dispatch: dispatcherMock },
        store,
        logger: debugWorkerLogger,
      });

      func1Function = worker.createFunction("func1", "foo", func1Mock);
    });

    afterEach(() => {
      store.clear();
    });

    describe("executionMode of ISOLATED", () => {
      beforeEach(() => {
        workerMount = worker.mount({
          functions: [func1Function],
          executionMode: "ISOLATED",
        });
      });

      describe("WorkerMount#execute", () => {
        it("publishes event to execution first step", async () => {
          store.setState({
            execution1: {},
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
            }
          );

          expect(store.getState()).toMatchInlineSnapshot(`
            {
              "execution1": {
                "func1": {
                  "transaction": true,
                },
              },
            }
          `);

          expect(func1Mock).not.toHaveBeenCalled();
          expect(aExecution1Mock).not.toHaveBeenCalled();
          expect(aExecution2Mock).not.toHaveBeenCalled();
          expect(aExecution3Mock).not.toHaveBeenCalled();

          expect(dispatcherMock).toHaveBeenCalledTimes(1);

          const request = dispatcherMock.mock.calls[0][0];

          expect(JSON.parse(request)).toMatchInlineSnapshot(`
            {
              "context": {
                "executionId": "execution1",
                "taskId": "func1",
                "timestamp": 1755036557392,
              },
              "event": {
                "type": "foo",
              },
            }
          `);
        });

        it("does no work if the task is already in progress", async () => {
          store.setState({
            execution1: {
              func1: {
                transaction: true,
              },
            },
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
            }
          );

          expect(aExecution1Mock).not.toHaveBeenCalled();
          expect(aExecution2Mock).not.toHaveBeenCalled();
          expect(aExecution3Mock).not.toHaveBeenCalled();
          expect(dispatcherMock).not.toHaveBeenCalled();
        });

        it("executes the function and starts first step execution", async () => {
          store.setState({
            execution1: {
              func1: {
                transaction: true,
              },
            },
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
              taskId: "func1",
            }
          );

          expect(store.getState()).toMatchInlineSnapshot(`
            {
              "execution1": {
                "func1": {
                  "transaction": true,
                },
                "func1:astep1": {
                  "transaction": true,
                },
              },
            }
          `);

          expect(func1Mock).toHaveBeenCalled();
          expect(aExecution1Mock).not.toHaveBeenCalled();
          expect(aExecution2Mock).not.toHaveBeenCalled();
          expect(aExecution3Mock).not.toHaveBeenCalled();

          expect(dispatcherMock).toHaveBeenCalledTimes(1);

          const request = dispatcherMock.mock.calls[0][0];

          expect(JSON.parse(request)).toMatchInlineSnapshot(`
            {
              "context": {
                "executionId": "execution1",
                "taskId": "func1:astep1",
                "timestamp": 1755036557392,
              },
              "event": {
                "type": "foo",
              },
            }
          `);
        });

        it("executes first step", async () => {
          store.setState({
            execution1: {
              func1: {
                transaction: true,
              },
              "func1:astep1": {
                transaction: true,
              },
            },
          });

          aExecution1Mock.mockResolvedValueOnce("astep1-result");

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
              taskId: "func1:astep1",
            }
          );

          expect(func1Mock).toHaveBeenCalled();
          expect(aExecution1Mock).toHaveBeenCalled();
          expect(aExecution2Mock).not.toHaveBeenCalled();
          expect(aExecution3Mock).not.toHaveBeenCalled();

          expect(dispatcherMock).toHaveBeenCalledTimes(1);

          const request = dispatcherMock.mock.calls[0][0];

          expect(JSON.parse(request)).toMatchInlineSnapshot(`
            {
              "context": {
                "executionId": "execution1",
                "taskId": "func1",
                "timestamp": 1755036557392,
              },
              "event": {
                "type": "foo",
              },
            }
          `);
        });

        it("begins execution for n", async () => {
          store.setState({
            execution1: {
              func1: {
                transaction: true,
              },
              "func1:astep1": {
                value: "astep1-result",
              },
            },
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
              taskId: "func1",
            }
          );

          expect(store.getState()).toMatchInlineSnapshot(`
            {
              "execution1": {
                "func1": {
                  "transaction": true,
                },
                "func1:astep1": {
                  "value": "astep1-result",
                },
                "func1:astep2": {
                  "transaction": true,
                },
              },
            }
          `);

          expect(aExecution1Mock).not.toHaveBeenCalled();
          expect(aExecution2Mock).not.toHaveBeenCalled();

          expect(dispatcherMock).toHaveBeenCalledTimes(1);

          const request = dispatcherMock.mock.calls[0][0];

          expect(JSON.parse(request)).toMatchInlineSnapshot(`
            {
              "context": {
                "executionId": "execution1",
                "taskId": "func1:astep2",
                "timestamp": 1755036557392,
              },
              "event": {
                "type": "foo",
              },
            }
          `);
        });

        it("executes for n", async () => {
          aExecution2Mock.mockResolvedValueOnce("astep2-result");

          store.setState({
            execution1: {
              func1: {
                transaction: true,
              },
              "func1:astep1": {
                value: "astep1-result",
              },
              "func1:astep2": {
                transaction: true,
              },
            },
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
              taskId: "func1:astep2",
            }
          );

          expect(store.getState()).toMatchInlineSnapshot(`
            {
              "execution1": {
                "func1": {
                  "transaction": true,
                },
                "func1:astep1": {
                  "value": "astep1-result",
                },
                "func1:astep2": {
                  "value": "astep2-result",
                },
              },
            }
          `);

          expect(aExecution1Mock).not.toHaveBeenCalled();
          expect(aExecution2Mock).toHaveBeenCalledTimes(1);
          expect(aExecution2Mock).toHaveBeenCalledWith("astep1-result");
          expect(aExecution3Mock).not.toHaveBeenCalled();

          expect(dispatcherMock).toHaveBeenCalledTimes(1);

          const request = dispatcherMock.mock.calls[0][0];

          expect(JSON.parse(request)).toMatchInlineSnapshot(`
            {
              "context": {
                "executionId": "execution1",
                "taskId": "func1",
                "timestamp": 1755036557392,
              },
              "event": {
                "type": "foo",
              },
            }
          `);
        });

        it("completes the function execution", async () => {
          store.setState({
            execution1: {
              func1: {
                transaction: true,
              },
              "func1:astep1": {
                value: "astep1-result",
              },
              "func1:astep2": {
                value: "astep2-result",
              },
            },
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
              taskId: "func1",
            }
          );

          expect(store.getState()).toMatchInlineSnapshot(`
            {
              "execution1": {
                "func1": {
                  "value": "<empty_execution_result>",
                },
                "func1:astep1": {
                  "value": "astep1-result",
                },
                "func1:astep2": {
                  "value": "astep2-result",
                },
              },
            }
          `);

          expect(aExecution1Mock).not.toHaveBeenCalled();
          expect(aExecution2Mock).not.toHaveBeenCalled();
          expect(aExecution3Mock).toHaveBeenCalledWith(
            "astep1-result",
            "astep2-result"
          );

          expect(dispatcherMock).toHaveBeenCalledTimes(1);

          const request = dispatcherMock.mock.calls[0][0];

          expect(JSON.parse(request)).toMatchInlineSnapshot(`
            {
              "context": {
                "executionId": "execution1",
                "timestamp": 1755036557392,
              },
              "event": {
                "type": "foo",
              },
            }
          `);
        });

        it("closes the execution and disposes the execution", async () => {
          store.setState({
            execution1: {
              func1: {
                value: "<empty_execution_result>",
              },
              "func1:astep1": {
                value: "astep1-result",
              },
              "func1:astep2": {
                value: "astep2-result",
              },
            },
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
            }
          );

          // biome-ignore lint/style/noUnusedTemplateLiteral: snapshot
          expect(store.getState()).toMatchInlineSnapshot(`{}`);

          expect(func1Mock).not.toHaveBeenCalled();
          expect(aExecution1Mock).not.toHaveBeenCalled();
          expect(aExecution2Mock).not.toHaveBeenCalled();
          expect(aExecution3Mock).not.toHaveBeenCalled();
          expect(dispatcherMock).not.toHaveBeenCalled();
        });

        it("supports try/catch", async () => {
          const error = new Error();
          aExecution2Mock.mockRejectedValue(error);

          store.setState({
            execution1: {
              func1: {
                transaction: true,
              },
              "func1:astep1": {
                value: "astep1-result",
              },
              "func1:astep2": {
                transaction: true,
              },
            },
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
              taskId: "func1:astep2",
            }
          );

          expect(aExecution2ErrorMock).toHaveBeenCalledWith(error);
        });

        describe("with simultaneous functions", () => {
          beforeEach(() => {
            workerMount = worker.mount({
              functions: [
                worker.createFunction("a1", "foo", aExecution1Mock),
                worker.createFunction("a2", "foo", aExecution2Mock),
              ],
            });

            aExecution2Mock.mockImplementation(() => setTimeout(100));
          });

          it("should dispose of exection when all functions are complete", async () => {
            store.setState({
              execution1: {},
            });

            await workerMount.execute(
              {
                type: "foo",
              },
              {
                timestamp,
                executionId: "execution1",
              }
            );

            expect(store.getState()).toMatchInlineSnapshot(`
              {
                "execution1": {
                  "a1": {
                    "transaction": true,
                  },
                  "a2": {
                    "transaction": true,
                  },
                },
              }
            `);

            expect(dispatcherMock).toHaveBeenCalledTimes(2);

            const request1 = dispatcherMock.mock.calls[0][0];

            expect(JSON.parse(request1)).toMatchInlineSnapshot(`
              {
                "context": {
                  "executionId": "execution1",
                  "taskId": "a1",
                  "timestamp": 1755036557392,
                },
                "event": {
                  "type": "foo",
                },
              }
            `);

            const request2 = dispatcherMock.mock.calls[1][0];

            expect(JSON.parse(request2)).toMatchInlineSnapshot(`
              {
                "context": {
                  "executionId": "execution1",
                  "taskId": "a2",
                  "timestamp": 1755036557392,
                },
                "event": {
                  "type": "foo",
                },
              }
            `);
          });
        });
      });
    });

    describe("executionMode of UNTIL_ERROR", () => {
      beforeEach(() => {
        workerMount = worker.mount({
          functions: [func1Function],
          executionMode: "UNTIL_ERROR",
        });
      });

      describe("WorkerMount#execute", () => {
        it("executes the whole function", async () => {
          aExecution1Mock.mockResolvedValue("astep1-result");
          aExecution2Mock.mockResolvedValue("astep2-result");

          store.setState({
            execution1: {},
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
            }
          );

          expect(store.getState()).toEqual({});

          expect(func1Mock).toHaveBeenCalled();
          expect(aExecution1Mock).toHaveBeenCalled();
          expect(aExecution2Mock).toHaveBeenCalledWith("astep1-result");
          expect(aExecution3Mock).toHaveBeenCalledWith(
            "astep1-result",
            "astep2-result"
          );

          expect(dispatcherMock).not.toHaveBeenCalled();
        });

        it("supports try/catch", async () => {
          aExecution1Mock.mockResolvedValue("astep1-result");
          const error = new Error();
          aExecution2Mock.mockRejectedValue(error);

          store.setState({
            execution1: {},
          });

          await workerMount.execute(
            {
              type: "foo",
            },
            {
              timestamp,
              executionId: "execution1",
            }
          );

          expect(store.getState()).toEqual({});

          expect(func1Mock).toHaveBeenCalled();
          expect(aExecution1Mock).toHaveBeenCalled();
          expect(aExecution2Mock).toHaveBeenCalledWith("astep1-result");
          expect(aExecution3Mock).not.toHaveBeenCalled();
          expect(aExecution2ErrorMock).toHaveBeenCalledWith(error);

          expect(dispatcherMock).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe("optimization: cache results of tasks in memory", () => {
    let getExecutionTaskResultSpy: jest.SpyInstance;
    let commitExecutionTaskResultSpy: jest.SpyInstance;
    let step1Mock: JestMockAny;
    let store: MemoryStore;
    let optimizationWorker: Worker<{ type: "test" }>;
    let optimizationMount: WorkerMount<{ type: "test" }>;

    beforeEach(() => {
      store = createMemoryStore();
      getExecutionTaskResultSpy = jest.spyOn(store, "getExecutionTaskResult");
      commitExecutionTaskResultSpy = jest.spyOn(
        store,
        "commitExecutionTaskResult"
      );
      step1Mock = jest.fn(() => "value-1");

      optimizationWorker = createWorker({
        eventsSchema: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("test"),
          }),
        ]),
        store,
        dispatcher: { dispatch: jest.fn() },
        logger: debugWorkerLogger,
      });

      optimizationMount = optimizationWorker.mount({
        functions: [
          optimizationWorker.createFunction(
            "testFunc",
            "test",
            async (event, { execute }) => {
              const result1 = await execute("step1", step1Mock);
              const result2 = await execute("step2", async () => "value-2");

              return { result1, result2 };
            }
          ),
        ],
        executionMode: "UNTIL_ERROR",
      });
    });

    afterEach(() => {
      store.clear();
      jest.restoreAllMocks();
    });

    it("should not call getExecutionTaskResult again when task result is cached", async () => {
      store.setState({
        execution1: {},
      });

      await optimizationMount.execute(
        { type: "test" },
        {
          timestamp: Date.now(),
          executionId: "execution1",
        }
      );

      expect(step1Mock).toHaveBeenCalledTimes(1);
      expect(getExecutionTaskResultSpy).toHaveBeenCalledTimes(3);
      expect(getExecutionTaskResultSpy).toHaveBeenNthCalledWith(
        1,
        "execution1",
        "testFunc"
      );
      expect(getExecutionTaskResultSpy).toHaveBeenNthCalledWith(
        2,
        "execution1",
        "testFunc:step1"
      );
      expect(getExecutionTaskResultSpy).toHaveBeenNthCalledWith(
        3,
        "execution1",
        "testFunc:step2"
      );
    });
  });

  describe("optimization: fetch all execution results ahead of time", () => {
    let getExecutionTaskResultSpy: jest.SpyInstance;
    let getExecutionTaskResultsSpy: jest.SpyInstance;
    let step1Mock: JestMockAny;
    let step2Mock: JestMockAny;
    let optimizationWorker: Worker<{ type: "test" }>;
    let optimizationMount: WorkerMount<{ type: "test" }>;

    describe("with getExecutionTaskResults method", () => {
      let store: MemoryStore;
      let executeCallbackMock: JestMockAny;

      beforeEach(() => {
        step1Mock = jest.fn(() => "value-1");
        step2Mock = jest.fn(() => "value-2");
        executeCallbackMock = jest.fn();

        store = createMemoryStore();
        getExecutionTaskResultSpy = jest.spyOn(store, "getExecutionTaskResult");
        getExecutionTaskResultsSpy = jest.spyOn(
          store,
          "getExecutionTaskResults"
        );

        optimizationWorker = createWorker({
          eventsSchema: z.discriminatedUnion("type", [
            z.object({
              type: z.literal("test"),
            }),
          ]),
          store,
          dispatcher: { dispatch: jest.fn() },
          logger: debugWorkerLogger,
        });

        optimizationMount = optimizationWorker.mount({
          functions: [
            optimizationWorker.createFunction(
              "testFunc",
              "test",
              async (event, { execute }) => {
                const result1 = await execute("step1", step1Mock);
                const result2 = await execute("step2", step2Mock);
                executeCallbackMock(result1, result2);
              }
            ),
          ],
          executionMode: "UNTIL_ERROR",
        });
      });

      afterEach(() => {
        store.clear();
        jest.restoreAllMocks();
      });

      it("should call getExecutionTaskResults once instead of multiple getExecutionTaskResult calls", async () => {
        store.setState({
          execution1: {
            testFunc: { transaction: true },
            "testFunc:step1": { value: "cached-step1-result" },
            "testFunc:step2": { value: "cached-step2-result" },
          },
        });

        await optimizationMount.execute(
          { type: "test" },
          {
            timestamp: Date.now(),
            executionId: "execution1",
            taskId: "testFunc",
          }
        );

        expect(getExecutionTaskResultsSpy).toHaveBeenCalledTimes(1);
        expect(getExecutionTaskResultsSpy).toHaveBeenCalledWith("execution1");

        expect(getExecutionTaskResultSpy).toHaveBeenCalledTimes(0);

        expect(step1Mock).not.toHaveBeenCalled();
        expect(step2Mock).not.toHaveBeenCalled();

        expect(executeCallbackMock).toHaveBeenCalledWith(
          "cached-step1-result",
          "cached-step2-result"
        );
      });
    });
  });
});
