import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";

export const EMPTY_EXECUTION_RESULT = "<empty_execution_result>";

export interface WorkerEvent<T extends string = string> {
  type: T;
}

export type WorkerEventFilter<
  T extends WorkerEvent = WorkerEvent,
  V extends T = T,
> = (event: T) => event is V;

export type WorkerFunctionHandler<T extends WorkerEvent = WorkerEvent> = (
  event: T,
  options: {
    executionId: string;
    timestamp: number;
    execute: <V>(key: string, callback: () => Promise<V>) => Promise<V>;
  }
) => Promise<unknown> | unknown;

export interface WorkerFunction {
  id: string;
  eventFilter: WorkerEventFilter;
  handler: WorkerFunctionHandler;
}

export interface WorkerMount<T extends WorkerEvent = WorkerEvent> {
  process(data: unknown): Promise<void>;
  execute(event: T, context?: WorkerExecutionContext): Promise<void>;
}

export interface WorkerStore {
  getExecutionTaskResult(
    executionId: WorkerExecutionContext["executionId"],
    taskId: string
  ): Promise<unknown | undefined>;
  beginExecutionTask(
    executionId: WorkerExecutionContext["executionId"],
    taskId: string
  ): Promise<void>;
  commitExecutionTaskResult(
    executionId: WorkerExecutionContext["executionId"],
    taskId: string,
    value: unknown
  ): Promise<void>;
  isExecutionTaskInProgress(
    executionId: WorkerExecutionContext["executionId"],
    taskId: string
  ): Promise<boolean>;
  disposeExecution(
    executionId: WorkerExecutionContext["executionId"]
  ): Promise<void>;
}

export interface WorkerOptions<T extends WorkerEvent = WorkerEvent, D = any> {
  eventsSchema: StandardSchemaV1<T>;
  store: WorkerStore;
  dispatcher: WorkerDispatcher<D>;
  onError?: (error: unknown) => Promise<unknown> | unknown;
  metrics?: WorkerMetrics;
  logger?: WorkerLogger;
  executor?: WorkerExecutor;
  concurrency?: number;
}

export type WorkerExecutionContext = z.TypeOf<typeof WorkerExecutionContext>;
export const WorkerExecutionContext = z.object({
  executionId: z.string(),
  timestamp: z.number(),
  functionId: z.string().optional(),
  executionTarget: z.string().optional(),
});

export type WorkerPublishRequestBody = z.TypeOf<
  typeof WorkerPublishRequestBody
>;
export const WorkerPublishRequestBody = z.object({
  event: z.unknown(),
  context: WorkerExecutionContext.optional(),
});

export interface Worker<T extends WorkerEvent, U = any> {
  eventsSchema: StandardSchemaV1<T>;

  configure(options: Partial<WorkerOptions<T, U>>): void;
  getOptions(): WorkerOptions<T, U>;
  createFunction<V extends T>(
    id: string,
    eventFilter: WorkerEventFilter<T, V>,
    handler: WorkerFunctionHandler<V>
  ): WorkerFunction;
  createFunction<U extends T["type"]>(
    id: string,
    eventFilter: U,
    handler: WorkerFunctionHandler<T extends WorkerEvent<U> ? T : never>
  ): WorkerFunction;
  createFunction<U extends T["type"]>(
    id: string,
    eventFilter: U[],
    handler: WorkerFunctionHandler<T extends WorkerEvent<U> ? T : never>
  ): WorkerFunction;

  mount(options: {
    functions: WorkerFunction[];
    sync?: boolean;
  }): WorkerMount<T>;

  publish(event: T, dispatcherOptions?: U): Promise<void>;
}

export interface WorkerMetrics {
  timing(
    metricName: string,
    tags: Record<string, string>,
    timings: [startTime: number, endTime: number]
  ): Promise<void>;

  increment(
    metricName: string,
    tags: Record<string, string>,
    value?: number
  ): Promise<void>;
}

export interface WorkerLogger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export type WorkerExecutor = (
  func: WorkerFunction,
  args: Parameters<WorkerFunctionHandler>,
  workerOptions: WorkerOptions
) => Promise<void>;

export type WorkerDispatcher<Options = any> = {
  dispatch: (data: string, options?: Options) => Promise<void>;
};
