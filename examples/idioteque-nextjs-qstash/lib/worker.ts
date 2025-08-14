import { createQStashDispatcher } from "@idioteque/qstash";
import { Redis } from "@upstash/redis";
import { createRedisStore, createWorker } from "idioteque";
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

export const dispatcher = createQStashDispatcher({
  mountUrl: `https://${process.env.VERCEL_URL}/api/worker`,
  token: process.env.QSTASH_TOKEN as string,
});

export const worker = createWorker({
  eventsSchema: EventsSchema,
  store: createRedisStore(Redis.fromEnv({ automaticDeserialization: false })),
  dispatcher,
});
