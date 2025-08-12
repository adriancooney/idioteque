import { setTimeout } from "node:timers/promises";
import { getOrder } from "../orders";
import { worker } from "../worker";

export default worker.createFunction(
  "process-payment",
  "order-created",
  async ({ orderId }, { execute }) => {
    const order = await execute("get-order-by-id", () => getOrder());

    console.log(
      `💳 Processing payment for order ${order.id} - $${order.amount}`
    );

    console.log("✅ Payment processed successfully");

    await worker.publish({
      type: "order-paid",
      orderId,
    });
  }
);
