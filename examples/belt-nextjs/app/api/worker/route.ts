import processPayment from "@/lib/functions/process-payment";
import sendOrderConfirmation from "@/lib/functions/send-order-confirmation";
import updateInventory from "@/lib/functions/update-inventory";
import { dispatcher, worker } from "@/lib/worker";

export const { POST } = dispatcher.mount(worker, {
  functions: [processPayment, sendOrderConfirmation, updateInventory],
});
