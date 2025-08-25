import { setupWorker } from "idioteque/testing";
import { worker } from "../worker";
import processPayment from "./process-payment";

describe("process-payment function", () => {
  setupWorker(worker, [processPayment]);

  it("should process payment for an order", async () => {
    await worker.publish({
      type: "order-created",
      orderId: "ord_123",
    });
  });
});
