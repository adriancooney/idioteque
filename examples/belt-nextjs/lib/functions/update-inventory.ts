import { getStores, updateInventory } from "../orders";
import { worker } from "../worker";

export default worker.createFunction(
  "update-inventory",
  "order-paid",
  async (event, { execute }) => {
    const stores = await execute("get-stores", () => getStores());

    await Promise.all(
      stores.map((store) =>
        execute(`update-inventory-${store}`, () => updateInventory(store))
      )
    );
  }
);
