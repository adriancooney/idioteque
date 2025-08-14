import z from "zod";
import { debugWorkerLogger } from "./logger";
import { type MemoryStore, createMemoryStore } from "./store";
import { setupWorker } from "./testing-utils";
import type { Worker, WorkerMount } from "./types";
import { createWorker } from "./worker";

type JestMockAny = jest.Mock<any, any, any>;

describe("testing-utils", () => {
  const dispatcherMock = jest.fn();
  const getOrderMock = jest
    .fn()
    .mockResolvedValue({ id: "order123", amount: 100 });

  const processPaymentMock = jest.fn(async (event, { execute }) => {
    await execute("get-order-by-id", () => getOrderMock());
  });

  const store = createMemoryStore();

  const worker = createWorker({
    eventsSchema: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("order-created"),
        orderId: z.string(),
      }),
    ]),
    dispatcher: { dispatch: dispatcherMock },
    store,
    logger: debugWorkerLogger,
  });

  describe(setupWorker, () => {
    setupWorker(worker, [
      worker.createFunction(
        "process-payment",
        "order-created",
        processPaymentMock
      ),
    ]);

    it("works", async () => {
      await worker.publish({
        type: "order-created",
        orderId: "foobar",
      });

      expect(getOrderMock).toHaveBeenCalled();
    });
  });
});
