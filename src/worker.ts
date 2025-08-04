import { map } from "bluebird";
import { compact, uniq } from "lodash";
import { defaultDispatcher } from "./dispatcher";
import { WorkerError } from "./errors";
import { defaultExecutor } from "./executor";
import { defaultWorkerLogger } from "./logger";
import { defaultWorkerMetrics } from "./metrics";
import {
  EMPTY_EXECUTION_RESULT,
  type Worker,
  type WorkerErrorResponse,
  type WorkerEvent,
  type WorkerExecutionContext,
  type WorkerFunction,
  type WorkerFunctionHandler,
  type WorkerOptions,
  WorkerPublishRequestBody,
} from "./types";
import { generateExecutionId } from "./util";

export function createWorker<T extends { type: string }, U>(
  workerOptions: WorkerOptions<T, U>
): Worker<T, U> {
  let {
    url,
    eventsSchema,
    concurrency,
    onError,
    metrics = defaultWorkerMetrics,
    logger = defaultWorkerLogger,
    executor = defaultExecutor,
    dispatcher = defaultDispatcher,
    store,
  } = workerOptions;

  async function publish(
    event: T,
    dispatcherOptions?: U,
    context?: WorkerExecutionContext
  ): Promise<void> {
    const request = new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event,
        context,
      } satisfies WorkerPublishRequestBody),
    });

    await dispatcher(request, dispatcherOptions);

    if (!context) {
      logger.debug(">> Published worker event", event);
      await metrics.increment("worker.publish", {
        url: url,
        eventType: event.type,
      });
    }
  }

  async function dispatchEventToFunctions(
    functions: WorkerFunction[],
    event: T,
    context: WorkerExecutionContext
  ): Promise<void> {
    const errors = compact(
      await map(
        functions,
        (func) => dispatchEventToFunction(func, event, context),
        {
          concurrency: concurrency || 3,
        }
      )
    );

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
    const isRootExecution = !context.executionTarget && !context.functionId;

    try {
      if (isRootExecution) {
        logger.debug(
          `Executing worker function ${func.id}`,
          event.type,
          context
        );
      }

      await new Promise((resolve, reject) =>
        executor(
          func,
          [
            event,
            {
              ...context,
              execute(key, callback) {
                // biome-ignore lint/suspicious/noAsyncPromiseExecutor: wrapped in try catch
                return new Promise(async (executeResolve, executeReject) => {
                  try {
                    if (!store) {
                      throw new Error("No store setup, cannot use execute");
                    }

                    const executionResult = await store.getExecutionTaskResult(
                      context.executionId,
                      key
                    );

                    if (executionResult !== undefined) {
                      executeResolve(
                        (executionResult === EMPTY_EXECUTION_RESULT
                          ? undefined
                          : executionResult) as any
                      );

                      return;
                    }

                    if (key === context.executionTarget) {
                      const result = await callback();

                      await store.commitExecutionTaskResult(
                        context.executionId,
                        key,
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
                        key
                      )
                    ) {
                      throw new WorkerInterrupt();
                    }

                    await store.beginExecutionTask(context.executionId, key);
                    await publish(event, undefined, {
                      functionId: func.id,
                      executionId: context.executionId,
                      timestamp: context.timestamp,
                      executionTarget: key,
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
              },
            },
          ],
          workerOptions
        )
          .then(resolve)
          .catch(reject)
      );

      if (store && context.executionId) {
        await store.disposeExecution(context.executionId);
      }

      if (isRootExecution) {
        await metrics.timing(
          "worker.run",
          {
            url: url,
            eventType: event.type,
          },
          [context.timestamp, Date.now()]
        );
      }

      return null;
    } catch (error) {
      if (error instanceof WorkerInterrupt) {
        return null;
      }

      await metrics.increment("worker.error", {
        url: url,
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
      url = options.url || url;
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
        url,
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

        POST: async (request: Request) => {
          try {
            const { event: unknownEvent, context } =
              WorkerPublishRequestBody.parse(await request.json());

            let result = eventsSchema["~standard"].validate(unknownEvent);

            if (result instanceof Promise) {
              result = await result;
            }

            if (result.issues) {
              throw new InvalidEventError(
                `Failed to parse event (executionId = ${context?.executionId})`
              );
            }

            const event = result.value;

            if (sync) {
              await execute(event, context);

              return new Response("DONE");
            }

            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode("ACK"));

                execute(event, context)
                  .then(() => {
                    controller.enqueue(encoder.encode("DONE"));
                    controller.close();
                  })
                  .catch((err) => controller.error(err));
              },
            });

            return new Response(stream, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          } catch (err) {
            const isNonRetryable = isNonRetryableError(err);

            return Response.json(
              {
                error: true,
                isNonRetryable,
                message: (err as Error).message,
                stack: (err as Error).stack,
              } satisfies WorkerErrorResponse,
              {
                status:
                  err instanceof InvalidEventError
                    ? 400
                    : isNonRetryable
                      ? 200
                      : 500,
              }
            );
          }
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

function isNonRetryableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "isNonRetryable" in error &&
    error.isNonRetryable === true
  );
}

function assertFunctionIdsUnique(functions: WorkerFunction[]): void {
  const functionIds = functions.map((func) => func.id);

  if (uniq(functionIds).length !== functionIds.length) {
    throw new Error("One or more functions with the same id");
  }
}

export class WorkerInterrupt extends Error {
  isNonRetryable = true;

  constructor() {
    super(
      `Worker Interrupt: if you're seeing this error, it means that you have wrapped your task in a try-catch. This is not possible, please remove it.`
    );
  }
}

class InvalidEventError extends Error {}
