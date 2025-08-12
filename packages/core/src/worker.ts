import { AsyncLocalStorage } from "node:async_hooks";
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
      await Promise.allSettled(
        functions.map((func) =>
          execute(
            context,
            event,
            func.id,
            async ({ execute }) =>
              await func.handler(event, { ...context, execute })
          )
        )
      )
    )
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);

    if (errors.length > 0) {
      throw errors[0];
    }

    logger.debug(`END ${context.executionId}`);
    await store.disposeExecution(context.executionId);
  }

  const pathAsyncLocalStore = new AsyncLocalStorage<string>();

  async function execute<V>(
    context: WorkerExecutionContext,
    event: T,
    taskId: string,
    callback: (options: {
      execute: <U>(taskId: string, callback: () => Promise<U>) => Promise<U>;
    }) => Promise<V>
  ): Promise<V> {
    const path = pathAsyncLocalStore.getStore() || "";
    const fullTaskId = `${path}:${taskId}`.replace(/^:/, "");
    const executionResult = await store.getExecutionTaskResult(
      context.executionId,
      fullTaskId
    );

    if (executionResult !== undefined) {
      logger.debug(`CACHE HIT ${context.executionId} > ${fullTaskId}`);

      return (
        executionResult === EMPTY_EXECUTION_RESULT ? undefined : executionResult
      ) as any;
    }

    if (context.taskId?.startsWith(fullTaskId)) {
      logger.debug(`EXECUTE ${context.executionId} > ${fullTaskId}`);

      const result = await pathAsyncLocalStore.run(
        fullTaskId,
        () =>
          new Promise((resolve, reject) =>
            callback({
              execute(subTaskId, callback) {
                // biome-ignore lint/suspicious/noAsyncPromiseExecutor:
                return new Promise(async (executeResolve, executeReject) => {
                  try {
                    executeResolve(
                      await execute(context, event, subTaskId, callback)
                    );
                  } catch (err) {
                    if (err instanceof WorkerInterrupt) {
                      logger.debug(
                        `INTERRUPT ${context.executionId} > ${context.taskId}: ${err.reason}`
                      );
                      // We purposely do not call `executeReject(err)` here so the execution
                      // of the function does not resume. We only reject the main function
                      // promise with the interrupt
                      reject(err);

                      return;
                    }

                    executeReject(err);
                  }
                });
              },
            })
              .then(resolve)
              .catch(reject)
          )
      );

      logger.debug(`COMMIT ${context.executionId} > ${fullTaskId}`);
      await store.commitExecutionTaskResult(
        context.executionId,
        fullTaskId,
        result === undefined ? EMPTY_EXECUTION_RESULT : result
      );

      const parentTaskId = fullTaskId.split(":").slice(0, -1).join(":");

      await publish(event, undefined, {
        executionId: context.executionId,
        timestamp: context.timestamp,
        taskId: parentTaskId ? parentTaskId : undefined,
      });

      throw new WorkerInterrupt("Task execution commited");
    }

    if (
      await store.isExecutionTaskInProgress(context.executionId, fullTaskId)
    ) {
      logger.debug(`TASK IN-PROGRESS ${context.executionId} > ${fullTaskId}`);
      throw new WorkerInterrupt("Task in progress");
    }

    logger.debug(`BEGIN TASK ${context.executionId} > ${fullTaskId}`);
    await store.beginExecutionTask(context.executionId, fullTaskId);
    await publish(event, undefined, {
      timestamp: context.timestamp,
      executionId: context.executionId,
      taskId: fullTaskId,
    });

    throw new WorkerInterrupt("Task execution started");
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

    mount({ functions }) {
      assertFunctionIdsUnique(functions);

      async function execute(
        event: T,
        context?: WorkerExecutionContext
      ): Promise<void> {
        const targetFunctions = filterFunctionsByEventAndContext(
          functions,
          event
        );

        if (!targetFunctions.length) {
          return;
        }

        if (!context) {
          // biome-ignore lint/style/noParameterAssign: ignore
          context = {
            executionId: generateExecutionId(),
            timestamp: Date.now(),
          };

          logger.debug(`START ${context.executionId}`);
          await store.beginExecution(context.executionId);
        }

        try {
          await dispatchEventToFunctions(targetFunctions, event, context);
        } catch (err) {
          if (err instanceof WorkerInterrupt) {
            return;
          }

          throw err;
        }
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

function filterFunctionsByEventAndContext<T extends WorkerEvent>(
  functions: WorkerFunction[],
  event: T
): WorkerFunction[] {
  return functions.filter((func) => func.eventFilter(event));
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
  reason: string;

  constructor(reason: string) {
    super(
      `Worker Interrupt: if you're seeing this error, it means that you have wrapped your task in a try-catch. This is not possible, please remove it.`
    );

    this.reason = reason;
  }
}

export class InvalidEventError extends Error {}
