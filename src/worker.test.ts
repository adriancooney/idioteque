import { z } from "zod";
import type { Worker, WorkerMount } from "./types";
import { createWorker } from "./worker";

type JestMockAny = jest.Mock<any, any, any>;

describe("worker", () => {
  let dispatcherMock: JestMockAny;
  let fooWorkerFunctionMock: JestMockAny;
  let barWorkerFunctionMock: JestMockAny;
  let worker: Worker<{ type: "foo" } | { type: "bar" }>;
  let workerMount: WorkerMount<{ type: "foo" } | { type: "bar" }>;
  const timestamp = Date.now();

  beforeEach(() => {
    dispatcherMock = jest.fn();
    fooWorkerFunctionMock = jest.fn();
    barWorkerFunctionMock = jest.fn();

    worker = createWorker({
      url: "https://foo.bar",
      eventsSchema: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("foo"),
        }),
        z.object({
          type: z.literal("bar"),
        }),
      ]),
      dispatcher: dispatcherMock,
    });

    workerMount = worker.mount({
      functions: [
        worker.createFunction("a", "foo", fooWorkerFunctionMock),
        worker.createFunction(
          "b",
          (event): event is { type: "bar" } => event.type === "bar",
          barWorkerFunctionMock
        ),
      ],
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("Worker#publish", () => {
    it("publishes event", async () => {
      await worker.publish({
        type: "foo",
      });

      expect(dispatcherMock).toHaveBeenCalled();

      const req = dispatcherMock.mock.calls[0][0] as Request;
      expect(req.url).toEqual("https://foo.bar/");
      expect(await req.json()).toEqual({
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

      expect(dispatcherMock).toHaveBeenCalledWith(expect.any(Request), {
        retries: 1,
      });
    });
  });

  describe("WorkerMount#execute", () => {
    it("executes the matching function", async () => {
      await workerMount.execute({
        type: "foo",
      });

      expect(fooWorkerFunctionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "foo",
        }),
        {
          execute: expect.any(Function),
          executionId: expect.any(String),
          timestamp: expect.any(Number),
        }
      );

      expect(barWorkerFunctionMock).not.toHaveBeenCalled();
    });

    it("executes the matching function (2)", async () => {
      await workerMount.execute({
        type: "bar",
      });

      expect(barWorkerFunctionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "bar",
        }),
        {
          execute: expect.any(Function),
          executionId: expect.any(String),
          timestamp: expect.any(Number),
        }
      );
      expect(fooWorkerFunctionMock).not.toHaveBeenCalled();
    });
  });

  describe("WorkerMount#POST", () => {
    it("executes the matching function", async () => {
      const request = new Request("https://foo.bar", {
        method: "POST",
        body: JSON.stringify({
          event: { type: "foo" },
        }),
      });

      const res = await workerMount.POST(request);

      expect(await res.text()).toEqual("ACKDONE");

      expect(fooWorkerFunctionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "foo",
        }),
        {
          execute: expect.any(Function),
          executionId: expect.any(String),
          timestamp: expect.any(Number),
        }
      );

      expect(barWorkerFunctionMock).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid event", async () => {
      const request = new Request("https://foo.bar", {
        method: "POST",
        body: JSON.stringify({ type: "unknown" }),
      });

      const res = await workerMount.POST(request);

      expect(res.status).toEqual(400);
      expect(await res.json()).toEqual(
        expect.objectContaining({
          error: true,
        })
      );
    });

    describe("with failing foo worker function", () => {
      let error: Error;

      beforeEach(() => {
        error = new Error("Oh no!");
        fooWorkerFunctionMock.mockRejectedValue(error);
      });

      it("gracefully handles worker errors", async () => {
        const request = new Request("https://foo.bar", {
          method: "POST",
          body: JSON.stringify({
            event: {
              type: "foo",
            },
          }),
        });

        const res = await workerMount.POST(request);

        expect(res.status).toEqual(200);

        await expect(() => res.json()).rejects.toEqual(error);
        expect(fooWorkerFunctionMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("with execute", () => {
    let aExecution1Mock: JestMockAny;
    let aExecution2Mock: JestMockAny;
    let aExecution2ErrorMock: JestMockAny;
    let aExecution3Mock: JestMockAny;

    let transactions: Record<string, any>;
    let executions: Record<string, any>;

    beforeEach(() => {
      dispatcherMock = jest.fn();
      aExecution1Mock = jest.fn();
      aExecution2Mock = jest.fn();
      aExecution2ErrorMock = jest.fn();
      aExecution3Mock = jest.fn();

      transactions = {};
      executions = {};

      worker = createWorker({
        url: "https://foo.bar",
        eventsSchema: z.discriminatedUnion("type", [
          z.object({
            type: z.literal("foo"),
          }),
          z.object({
            type: z.literal("bar"),
          }),
        ]),
        dispatcher: dispatcherMock,
        store: {
          async getExecutionTaskResult(executionId, resultId) {
            return executions[`${executionId}-${resultId}`];
          },
          async isExecutionTaskInProgress(executionId, resultId) {
            return transactions[`${executionId}-${resultId}`] || false;
          },
          async beginExecutionTask(executionId, resultId) {
            transactions[`${executionId}-${resultId}`] = true;
          },
          async commitExecutionTaskResult(executionId, resultId, value) {
            delete transactions[`${executionId}-${resultId}`];
            executions[`${executionId}-${resultId}`] = value;
          },
          async disposeExecution(executionId) {
            for (const key of Object.keys(executions)) {
              if (key.startsWith(executionId)) {
                delete executions[key];
              }
            }
          },
        },
      });

      workerMount = worker.mount({
        functions: [
          worker.createFunction("a", "foo", async (event, { execute }) => {
            const aExecution1Result = await execute("astep1", aExecution1Mock);

            try {
              const aExecution2Result = await execute("astep2", () =>
                aExecution2Mock(aExecution1Result)
              );

              await aExecution3Mock(aExecution1Result, aExecution2Result);
            } catch (err) {
              aExecution2ErrorMock(err);
            }
          }),
        ],
      });
    });

    describe("WorkerMount#execute", () => {
      it("publishes event to execution first step", async () => {
        await workerMount.execute(
          {
            type: "foo",
          },
          {
            executionId: "execution1",
            timestamp,
          }
        );

        expect(transactions).toEqual({
          "execution1-astep1": true,
        });

        expect(executions).toEqual({});
        expect(aExecution1Mock).not.toHaveBeenCalled();
        expect(aExecution2Mock).not.toHaveBeenCalled();
        expect(aExecution3Mock).not.toHaveBeenCalled();

        expect(dispatcherMock).toHaveBeenCalledTimes(1);

        const request = dispatcherMock.mock.calls[0][0] as Request;

        expect(await request.json()).toEqual({
          event: {
            type: "foo",
          },
          context: {
            timestamp,
            executionId: "execution1",
            functionId: "a",
            executionTarget: "astep1",
          },
        });
      });

      it("executes the first step", async () => {
        aExecution1Mock.mockResolvedValueOnce("astep1-result");

        await workerMount.execute(
          {
            type: "foo",
          },
          {
            timestamp,
            executionId: "execution1",
            functionId: "a",
            executionTarget: "astep1",
          }
        );

        expect(transactions).toEqual({});
        expect(executions).toEqual({
          "execution1-astep1": "astep1-result",
        });

        expect(aExecution1Mock).toHaveBeenCalledTimes(1);
        expect(aExecution1Mock).toHaveBeenCalledWith();

        expect(aExecution2Mock).not.toHaveBeenCalled();
        expect(aExecution3Mock).not.toHaveBeenCalled();

        expect(dispatcherMock).toHaveBeenCalledTimes(1);

        const request = dispatcherMock.mock.calls[0][0] as Request;

        expect(await request.json()).toEqual({
          event: {
            type: "foo",
          },
          context: {
            timestamp,
            executionId: "execution1",
            functionId: "a",
          },
        });
      });

      it("publishes event to begin execution for n", async () => {
        executions = {
          "execution1-astep1": "astep1-result",
        };

        await workerMount.execute(
          {
            type: "foo",
          },
          {
            timestamp,
            executionId: "execution1",
            functionId: "a",
          }
        );

        expect(transactions).toEqual({
          "execution1-astep2": true,
        });
        expect(executions).toEqual({
          "execution1-astep1": "astep1-result",
        });

        expect(aExecution1Mock).not.toHaveBeenCalled();
        expect(aExecution2Mock).not.toHaveBeenCalled();

        expect(dispatcherMock).toHaveBeenCalledTimes(1);

        const request = dispatcherMock.mock.calls[0][0] as Request;

        expect(await request.json()).toEqual({
          event: {
            type: "foo",
          },
          context: {
            timestamp,
            executionId: "execution1",
            functionId: "a",
            executionTarget: "astep2",
          },
        });
      });

      it("executes for n", async () => {
        aExecution2Mock.mockResolvedValueOnce("astep2-result");

        executions = {
          "execution1-astep1": "astep1-result",
        };

        await workerMount.execute(
          {
            type: "foo",
          },
          {
            timestamp,
            executionId: "execution1",
            functionId: "a",
            executionTarget: "astep2",
          }
        );

        expect(transactions).toEqual({});
        expect(executions).toEqual({
          "execution1-astep1": "astep1-result",
          "execution1-astep2": "astep2-result",
        });

        expect(aExecution1Mock).not.toHaveBeenCalled();
        expect(aExecution2Mock).toHaveBeenCalledTimes(1);
        expect(aExecution2Mock).toHaveBeenCalledWith("astep1-result");
        expect(aExecution3Mock).not.toHaveBeenCalled();

        expect(dispatcherMock).toHaveBeenCalledTimes(1);

        const request = dispatcherMock.mock.calls[0][0] as Request;

        expect(await request.json()).toEqual({
          event: {
            type: "foo",
          },
          context: {
            timestamp,
            executionId: "execution1",
            functionId: "a",
          },
        });
      });

      it("commits the execution", async () => {
        aExecution2Mock.mockResolvedValueOnce("astep2-result");

        executions = {
          "execution1-astep1": "astep1-result",
          "execution1-astep2": "astep2-result",
        };

        await workerMount.execute(
          {
            type: "foo",
          },
          {
            timestamp,
            executionId: "execution1",
            functionId: "a",
          }
        );

        expect(transactions).toEqual({});
        expect(executions).toEqual({});

        expect(aExecution1Mock).not.toHaveBeenCalled();
        expect(aExecution2Mock).not.toHaveBeenCalled();
        expect(aExecution3Mock).toHaveBeenCalledTimes(1);
        expect(aExecution3Mock).toHaveBeenCalledWith(
          "astep1-result",
          "astep2-result"
        );
        expect(dispatcherMock).not.toHaveBeenCalled();
      });

      it("should not execute step if it is in progress", async () => {
        transactions = {
          "execution1-astep1": true,
        };

        await workerMount.execute(
          {
            type: "foo",
          },
          {
            timestamp,
            executionId: "execution1",
            functionId: "a",
          }
        );

        expect(transactions).toEqual({
          "execution1-astep1": true,
        });
        expect(executions).toEqual({});

        expect(aExecution1Mock).not.toHaveBeenCalled();
        expect(dispatcherMock).not.toHaveBeenCalled();
      });

      it("supports try/catch", async () => {
        const error = new Error();
        aExecution2Mock.mockRejectedValue(error);

        executions = {
          "execution1-astep1": "astep1-result",
        };

        await workerMount.execute(
          {
            type: "foo",
          },
          {
            timestamp,
            executionId: "execution1",
            functionId: "a",
            executionTarget: "astep2",
          }
        );

        expect(aExecution2ErrorMock).toHaveBeenCalledWith(error);
      });
    });
  });
});
