import { map } from "bluebird";
import { WorkerError } from "./errors";
import { defaultExecutor } from "./executor";
import { defaultWorkerLogger } from "./logger";
import { defaultWorkerMetrics } from "./metrics";
import {
  EMPTY_EXECUTION_RESULT,
  type Worker,
  type WorkerEvent,
  type WorkerExecutionContext,
  type WorkerFunction,
  type WorkerFunctionHandler,
  type WorkerOptions,
  WorkerPublishRequestBody,
} from "./types";
import { generateExecutionId, jsonString } from "./util";

export function createWorker<T extends { type: string }, U>(
  workerOptions: WorkerOptions<T, U>
): Worker<T, U> {
  let {
    eventsSchema,
    concurrency,
    onError,
    metrics = defaultWorkerMetrics,
    logger = defaultWorkerLogger,
    executor = defaultExecutor,
    dispatcher,
    store,
  } = workerOptions;

  async function publish(
    event: T,
    dispatcherOptions?: U,
    context?: WorkerExecutionContext
  ): Promise<void> {
    await dispatcher.dispatch(
      JSON.stringify({
        event,
        context,
      } satisfies WorkerPublishRequestBody),
      dispatcherOptions
    );

    if (!context) {
      logger.debug(">> Published worker event", event);
      await metrics.increment("worker.publish", {
        eventType: event.type,
      });
    }
  }

  async function dispatchEventToFunctions(
    functions: WorkerFunction[],
    event: T,
    context: WorkerExecutionContext
  ): Promise<void> {
    const errors = (
      await map(
        functions,
        (func) => dispatchEventToFunction(func, event, context),
        {
          concurrency: concurrency || 3,
        }
      )
    ).filter(Boolean);

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new WorkerError(
        `One or more worker functions failed to execute: ${formatError(
          errors[0]
        )}`
      );
    }
  }

  async function dispatchEventToFunction(
    func: WorkerFunction,
    event: T,
    context: WorkerExecutionContext
  ): Promise<unknown | null> {
    const dispatchId = generateExecutionId();
    const isRootExecution = !context.executionTarget && !context.functionId;

    try {
      if (isRootExecution) {
        logger.debug(
          `Executing worker function ${func.id}`,
          event.type,
          context
        );
      }

      console.log(`[${dispatchId}] START ${context.executionId}`);

      await new Promise((resolve, reject) => {
        function execute<V>(
          taskId: string,
          callback: () => Promise<V>
        ): Promise<V> {
          // biome-ignore lint/suspicious/noAsyncPromiseExecutor: wrapped in try catch
          return new Promise(async (executeResolve, executeReject) => {
            try {
              const executionResult = await store.getExecutionTaskResult(
                context.executionId,
                taskId
              );

              if (executionResult !== undefined) {
                console.log(
                  `[${dispatchId}] CACHE HIT ${context.executionId} > ${taskId}`
                );
                executeResolve(
                  (executionResult === EMPTY_EXECUTION_RESULT
                    ? undefined
                    : executionResult) as any
                );

                return;
              }

              if (taskId === context.executionTarget) {
                const result = await callback();

                console.log(
                  `[${dispatchId}] COMMIT ${context.executionId} > ${taskId}`
                );
                await store.commitExecutionTaskResult(
                  context.executionId,
                  taskId,
                  result === undefined ? EMPTY_EXECUTION_RESULT : result
                );

                await publish(event, undefined, {
                  functionId: func.id,
                  executionId: context.executionId,
                  timestamp: context.timestamp,
                });

                throw new WorkerInterrupt();
              }

              if (
                await store.isExecutionTaskInProgress(
                  context.executionId,
                  taskId
                )
              ) {
                console.log(
                  `[${dispatchId}] IN-PROGRESS ${context.executionId} > ${taskId}`
                );
                throw new WorkerInterrupt();
              }

              console.log(
                `[${dispatchId}] BEGIN ${context.executionId} > ${taskId}`
              );
              await store.beginExecutionTask(context.executionId, taskId);
              await publish(event, undefined, {
                functionId: func.id,
                executionId: context.executionId,
                timestamp: context.timestamp,
                executionTarget: taskId,
              });

              throw new WorkerInterrupt();
            } catch (err) {
              if (err instanceof WorkerInterrupt) {
                reject(err);

                return;
              }

              executeReject(err);
            }
          });
        }

        return executor(
          func,
          [
            event,
            {
              ...context,
              execute,
            },
          ],
          workerOptions
        )
          .then(resolve)
          .catch(reject);
      });

      if (context.executionId) {
        console.log(`[${dispatchId}] DISPOSE ${context.executionId}`);
        await store.disposeExecution(context.executionId);
      }

      if (isRootExecution) {
        await metrics.timing(
          "worker.run",
          {
            eventType: event.type,
          },
          [context.timestamp, Date.now()]
        );
      }

      console.log(`[${dispatchId}] END ${context.executionId}`);

      return null;
    } catch (error) {
      if (error instanceof WorkerInterrupt) {
        console.log(`[${dispatchId}] END ${context.executionId}`);
        return null;
      }

      await metrics.increment("worker.error", {
        eventType: event.type,
      });

      logger.debug(`Worker function ${func.id} failed`, event, context, error);

      onError?.(error);

      return error;
    }
  }

  return {
    publish,
    eventsSchema: eventsSchema,

    configure(options: Partial<WorkerOptions<T>>) {
      eventsSchema = options.eventsSchema || eventsSchema;
      concurrency = options.concurrency || concurrency;
      onError = options.onError || onError;
      metrics = options.metrics || metrics;
      logger = options.logger || logger;
      executor = options.executor || executor;
      dispatcher = options.dispatcher || dispatcher;
      store = options.store || store;
    },

    getOptions(): WorkerOptions<T> {
      return {
        eventsSchema,
        concurrency,
        onError,
        metrics,
        logger,
        executor,
        dispatcher,
        store,
      };
    },

    createFunction(id: string, eventFilter: any, handler: any) {
      // biome-ignore lint/suspicious/noImplicitAnyLet: Type is discarded
      let eventFilterCallback;

      if (typeof eventFilter === "string") {
        eventFilterCallback = (event: WorkerEvent) =>
          event.type === eventFilter;
      } else if (Array.isArray(eventFilter)) {
        eventFilterCallback = (event: WorkerEvent) =>
          eventFilter.includes(event.type);
      } else {
        eventFilterCallback = eventFilter;
      }

      return {
        id,
        eventFilter: eventFilterCallback,
        handler: handler as WorkerFunctionHandler,
      };
    },

    mount({ functions, sync = false }) {
      assertFunctionIdsUnique(functions);

      async function execute(
        event: T,
        context?: WorkerExecutionContext
      ): Promise<void> {
        const targetFunctions = filterFunctionsByEventAndContext(
          functions,
          event,
          context
        );

        if (!context) {
          // biome-ignore lint/style/noParameterAssign: ignore
          context = {
            executionId: generateExecutionId(),
            timestamp: Date.now(),
          };
        }

        await dispatchEventToFunctions(targetFunctions, event, context);
      }

      return {
        execute,

        async process(data) {
          const { event: unknownEvent, context } = jsonString
            .pipe(WorkerPublishRequestBody)
            .parse(data);

          const result = await eventsSchema["~standard"].validate(unknownEvent);

          if (result.issues) {
            throw new InvalidEventError(
              `Failed to parse event (executionId = ${context?.executionId})`
            );
          }

          const event = result.value;

          await execute(event, context);
        },
      };
    },
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return `${error}`;
}

function filterFunctionsByEventAndContext<T extends WorkerEvent>(
  functions: WorkerFunction[],
  event: T,
  context?: WorkerExecutionContext
): WorkerFunction[] {
  return functions.filter((func) => {
    if (context?.functionId) {
      return func.id === context?.functionId;
    }

    return func.eventFilter(event);
  });
}

function assertFunctionIdsUnique(functions: WorkerFunction[]): void {
  const functionIds = functions.map((func) => func.id);
  const uniqueFunctionIds = functionIds.filter(
    (functionId, i, all) => all.indexOf(functionId) === i
  );

  if (uniqueFunctionIds.length !== functionIds.length) {
    throw new Error("One or more functions with the same id");
  }
}

export class WorkerInterrupt extends Error {
  constructor() {
    super(
      `Worker Interrupt: if you're seeing this error, it means that you have wrapped your task in a try-catch. This is not possible, please remove it.`
    );
  }
}

export class InvalidEventError extends Error {}
