import os from "node:os";
import path from "node:path";
import { createVercelQueueDispatcher } from "@idioteque/vercel-queue";
import { createFileSystemStore, createWorker } from "idioteque";
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

export const dispatcher = createVercelQueueDispatcher();

export const worker = createWorker({
  eventsSchema: EventsSchema,
  store: createFileSystemStore(
    path.join(os.tmpdir(), "idioteque-worker-store")
  ),
  dispatcher,
});
