import type { WorkerLogger } from "./types";

export const defaultWorkerLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} satisfies WorkerLogger;

export const debugWorkerLogger = {
  debug: console.log,
  info: console.log,
  warn: console.warn,
  error: console.error,
} satisfies WorkerLogger;
