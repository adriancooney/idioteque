import type { WorkerLogger } from "./types";

export const defaultWorkerLogger = {
  debug: console.log,
  info: console.log,
  warn: console.warn,
  error: console.error,
} satisfies WorkerLogger;
