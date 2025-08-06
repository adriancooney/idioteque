import processPayment from "@/lib/functions/process-payment";
import sendOrderConfirmation from "@/lib/functions/send-order-confirmation";
import updateInventory from "@/lib/functions/update-inventory";
import { worker } from "@/lib/worker";

export const { POST } = worker.mount({
  functions: [processPayment, sendOrderConfirmation, updateInventory],
});
