import os from "node:os";
import path from "node:path";
import { createFileSystemStore, createWorker } from "@belt/core";
import { createVercelQueueDispatcher } from "@belt/vercel-queue";
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
  store: createFileSystemStore(path.join(os.tmpdir(), "belt-worker-store")),
  dispatcher,
});
