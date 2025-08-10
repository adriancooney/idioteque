import os from "node:os";
import path from "node:path";
import {
  createFileSystemWorkerStore,
  createVercelQueueDispatcher,
  createWorker,
} from "@belt/core";
import z from "zod";

const EventsSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("order-created"),
    orderId: z.string(),
  }),
  z.object({
    type: z.literal("order-paid"),
    orderId: z.string(),
  }),
]);

export const worker = createWorker({
  url: `${
    process.env.NODE_ENV === "production"
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"
  }/api/worker`,

  eventsSchema: EventsSchema,
  store: createFileSystemWorkerStore(
    path.join(os.tmpdir(), "belt-worker-store")
  ),
  dispatcher: createVercelQueueDispatcher(),
});
