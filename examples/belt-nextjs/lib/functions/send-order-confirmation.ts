import { setTimeout } from "node:timers/promises";
import { getOrder } from "../orders";
import { worker } from "../worker";

export default worker.createFunction(
  "send-order-confirmation",
  "order-paid",
  async ({ orderId }, { execute }) => {
    const order = await execute("get-order-by-id", () => getOrder());

    await execute("send-confirmation", async () => {
      console.log(`📧 Sending confirmation to ${order.customerEmail}`);

      await setTimeout(2000);

      console.log(`✅ Confirmation email sent for order ${orderId}`);
    });
  }
);
