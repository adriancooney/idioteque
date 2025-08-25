import { AsyncLocalStorage } from "node:async_hooks";
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
  const pathAsyncLocalStore = new AsyncLocalStorage<string>();

  let {
    eventsSchema,
    onError,
    metrics = defaultWorkerMetrics,
    logger = defaultWorkerLogger,
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
      logger.debug(`PUBLISH | ${event.type}`);
      await metrics.increment("worker.publish", {
        eventType: event.type,
      });
    }
  }

  async function dispatchEventToFunctions(
    functions: WorkerFunction[],
    event: T,
    context: WorkerExecutionContext,
    enqueueTask: (taskId?: string) => Promise<void>,
    executionCache: Record<string, unknown>
  ): Promise<void> {
    if (!(await store.isExecutionInProgress(context.executionId))) {
      // This can happen for delayed idempotent events
      logger.debug(`${context.executionId} | EXECUTION NOT FOUND, SKIPPING`);

      return;
    }

    const errors = (
      await Promise.allSettled(
        functions.map((func) =>
          execute(
            context,
            event,
            enqueueTask,
            func.id,
            async ({ execute }) =>
              await func.handler(event, { ...context, execute }),
            executionCache
          )
        )
      )
    )
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);

    if (errors.length > 0) {
      throw errors[0];
    }

    logger.debug(`${context.executionId} | EXECUTION END`);
    await store.disposeExecution(context.executionId);
  }

  // Task results are immutable and can be cached in memory. This saves trips to
  // the store when executionMode is UNTIL_ERROR. The cache is shortlived and
  // per dispatch.
  async function getExecutionTaskResultCached(
    executionCache: Record<string, unknown>,
    executionId: string,
    taskId: string
  ): Promise<unknown | undefined> {
    const cachedValue = executionCache[taskId];

    if (cachedValue !== undefined) {
      return cachedValue;
    }

    return await store.getExecutionTaskResult(executionId, taskId);
  }

  async function commitExecutionTaskResultCached(
    executionCache: Record<string, unknown>,
    executionId: string,
    taskId: string,
    value: unknown
  ): Promise<void> {
    executionCache[taskId] = value;

    await store.commitExecutionTaskResult(executionId, taskId, value);
  }

  async function execute<V>(
    context: WorkerExecutionContext,
    event: T,
    enqueueTask: (taskId?: string) => Promise<void>,
    taskId: string,
    callback: (options: {
      execute: <U>(taskId: string, callback: () => Promise<U>) => Promise<U>;
    }) => Promise<V>,
    executionCache: Record<string, unknown>
  ): Promise<V> {
    const path = pathAsyncLocalStore.getStore() || "";
    const fullTaskId = `${path}:${taskId}`.replace(/^:/, "");

    if (context.taskId?.startsWith(fullTaskId)) {
      logger.debug(`${context.executionId} | ${fullTaskId} | EXECUTE`);

      const result = await pathAsyncLocalStore.run(
        fullTaskId,
        () =>
          new Promise((resolve, reject) =>
            Promise.resolve(
              callback({
                execute(subTaskId, callback) {
                  // biome-ignore lint/suspicious/noAsyncPromiseExecutor:
                  return new Promise(async (executeResolve, executeReject) => {
                    try {
                      executeResolve(
                        await execute(
                          context,
                          event,
                          enqueueTask,
                          subTaskId,
                          callback,
                          executionCache
                        )
                      );
                    } catch (err) {
                      if (err instanceof WorkerInterrupt) {
                        logger.debug(
                          `${context.executionId} | ${context.taskId} | INTERRUPT | ${err.reason}`
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
            )
              .then(resolve)
              .catch(reject)
          )
      );

      logger.debug(`${context.executionId} | ${fullTaskId} | COMMIT`);
      await commitExecutionTaskResultCached(
        executionCache,
        context.executionId,
        fullTaskId,
        result === undefined ? EMPTY_EXECUTION_RESULT : result
      );

      const parentTaskId = fullTaskId.split(":").slice(0, -1).join(":");
      const nextTaskId = parentTaskId || undefined;

      await enqueueTask(nextTaskId);

      throw new WorkerInterrupt({
        reason: `Task '${fullTaskId}' execution committed${
          nextTaskId ? `, triggering '${nextTaskId}' next` : ""
        }`,
      });
    }

    const executionResult = await getExecutionTaskResultCached(
      executionCache,
      context.executionId,
      fullTaskId
    );

    if (executionResult !== undefined) {
      logger.debug(`${context.executionId} | ${fullTaskId} | CACHE HIT`);

      return (
        executionResult === EMPTY_EXECUTION_RESULT ? undefined : executionResult
      ) as any;
    }

    if (
      await store.isExecutionTaskInProgress(context.executionId, fullTaskId)
    ) {
      logger.debug(`${context.executionId} | ${fullTaskId} | TASK IN-PROGRESS`);
      throw new WorkerInterrupt({
        reason: `Task '${fullTaskId}' in progress, skipping`,
      });
    }

    logger.debug(`${context.executionId} | ${fullTaskId} | BEGIN TASK`);
    await store.beginExecutionTask(context.executionId, fullTaskId);

    await enqueueTask(fullTaskId);
    throw new WorkerInterrupt({
      reason: `Task '${fullTaskId}' execution triggered`,
    });
  }

  return {
    publish,
    eventsSchema: eventsSchema,

    configure(options: Partial<WorkerOptions<T>>) {
      eventsSchema = options.eventsSchema || eventsSchema;
      onError = options.onError || onError;
      metrics = options.metrics || metrics;
      logger = options.logger || logger;
      dispatcher = options.dispatcher || dispatcher;
      store = options.store || store;
    },

    getOptions(): WorkerOptions<T> {
      return {
        eventsSchema,
        onError,
        metrics,
        logger,
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

    mount({ functions, executionMode = "ISOLATED" }) {
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

          logger.debug(`${context.executionId} | EXECUTION START`);
          await store.beginExecution(context.executionId);
        }

        const executionCache = store.getExecutionTaskResults
          ? await store.getExecutionTaskResults(context.executionId)
          : {};

        const queue: WorkerExecutionContext[] = [context];
        let head: WorkerExecutionContext | undefined;

        // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
        while ((head = queue.shift())) {
          try {
            await dispatchEventToFunctions(
              targetFunctions,
              event,
              head,
              async (taskId) => {
                if (executionMode === "UNTIL_ERROR") {
                  queue.push({
                    ...context,
                    taskId,
                  });
                } else {
                  // Test dispatchers immediately execute on publish which continues
                  // the async local storage stack and causes an infinite loop. this
                  // prevents that.
                  pathAsyncLocalStore.disable();

                  await publish(event, undefined, {
                    ...context,
                    taskId,
                  });
                }
              },
              executionCache
            );
          } catch (err) {
            if (err instanceof WorkerInterrupt) {
              continue;
            }

            throw err;
          }
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

  constructor(options: { reason: string }) {
    super(
      `Worker Interrupt: if you're seeing this error, it means that you have wrapped your task in a try-catch. This is not possible, please remove it.`
    );

    this.reason = options.reason;
  }
}

export class InvalidEventError extends Error {}
