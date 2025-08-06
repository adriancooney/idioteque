import { setTimeout } from "node:timers/promises";

export async function getStores(): Promise<string[]> {
  return ["LA", "NY", "TX"];
}

export async function updateInventory(store: string): Promise<void> {
  await setTimeout(5000 * Math.random());

  console.log(`🏣 ${store} store inventory updated`);
}
