import { setTimeout } from "node:timers/promises";
import { worker } from "./worker";

interface Order {
  id: string;
  amount: number;
  customerEmail: string;
}

const order: Order = {
  id: `ord_${Date.now()}`,
  amount: 99.9,
  customerEmail: "skeleton@bank.com",
};

export async function createOrder() {
  console.log(
    `📦 Order ${order.id} created (${order.customerEmail}, $${order.amount.toFixed(2)})`
  );

  await worker.publish({
    type: "order-created",
    orderId: order.id,
  });
}

export async function getOrder(): Promise<Order> {
  // Simulate work
  await setTimeout(2000);

  return order;
}
