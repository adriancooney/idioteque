# idioteque

Core idioteque library for building fault-tolerant, resumable async workers in TypeScript.

## Features

- 🔄 **Resumable execution** - Tasks can be interrupted and resumed from where they left off
- 🛡️ **Distributed, fault tolerant** - Execution state is persisted and recoverable
- 🌳 **Hierarchical task execution** - Support for nested tasks with path-based organization
- ⚙️ **Flexible execution modes** - Choose between isolated or sequential execution
- 🔒 **Type-safe events** - Full TypeScript support with schema validation
- ✨ **Simple API** - Clean, intuitive interface for defining workflows

## Installation

```bash
npm install idioteque
# Or with your preferred package manager
pnpm add idioteque
yarn add idioteque
```

## Quick Start

```typescript
import { createWorker, createMemoryStore, createDangerousFetchDispatcher } from 'idioteque';
import { z } from 'zod';

// Define your event schema
const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user.signup'), userId: z.string() }),
]);

// Create worker
const worker = createWorker({
  eventsSchema: EventSchema,
  store: createMemoryStore(), // Use createRedisStore() for production
  dispatcher: createDangerousFetchDispatcher({ mountUrl: '/api/worker' })
});

// Define function
const processSignup = worker.createFunction(
  'process-signup',
  'user.signup',
  async (event, { execute }) => {
    const user = await execute('fetch-user', () => getUserById(event.userId));
    await execute('send-email', () => sendWelcomeEmail(user.email));
  }
);

// Mount worker
const { process } = worker.mount({ functions: [processSignup] });
```

## API

### `createWorker(options)`

Creates a new worker instance.

**Parameters:**
- `options.eventsSchema` - Zod schema for event validation
- `options.store` - Storage backend for execution state
- `options.dispatcher` - Message dispatcher for event delivery
- `options.logger?` - Custom logger (default: `defaultWorkerLogger`)
- `options.metrics?` - Custom metrics collector (default: `defaultWorkerMetrics`)
- `options.onError?` - Global error handler

**Returns:** `Worker<T>`

```typescript
import { createWorker, createMemoryStore, createDangerousFetchDispatcher } from 'idioteque';

const worker = createWorker({
  eventsSchema: EventSchema,
  store: createMemoryStore(),
  dispatcher: createDangerousFetchDispatcher({ mountUrl: '/api/worker' }),
  logger: debugWorkerLogger, // Optional: use debug logger
  onError: (error) => console.error('Worker error:', error), // Optional: global error handler
});
```

### `worker.createFunction(id, eventFilter, handler)`

Creates an event handler function.

**Parameters:**
- `id: string` - Unique function identifier
- `eventFilter` - Event type string, array of types, or filter function
- `handler` - Async function to handle the event

**Returns:** `WorkerFunction`

```typescript
// String filter
const fn1 = worker.createFunction('fn1', 'user.signup', handler);

// Array filter
const fn2 = worker.createFunction('fn2', ['user.signup', 'user.login'], handler);

// Function filter
const fn3 = worker.createFunction('fn3', (event) => event.type.startsWith('user.'), handler);
```

### `worker.mount(options)`

Mounts functions and returns execution interface.

**Parameters:**
- `options.functions` - Array of worker functions
- `options.executionMode?` - 'ISOLATED' (default) or 'UNTIL_ERROR'

**Returns:** `{ execute: Function, process: Function }`

```typescript
const { execute, process } = worker.mount({
  functions: [processSignup, sendEmail],
  executionMode: 'ISOLATED' // or 'UNTIL_ERROR'
});

// Execute events directly
await execute({ type: 'user.signup', userId: '123' });

// Process serialized data (for API endpoints)
await process(JSON.stringify({ event: {...}, context: {...} }));
```

### `worker.publish(event, dispatcherOptions?, context?)`

Publishes an event for processing.

**Parameters:**
- `event` - Event object matching your schema
- `dispatcherOptions?` - Options passed to dispatcher
- `context?` - Execution context for resuming workflows

**Returns:** `Promise<void>`

```typescript
// Publish new event
await worker.publish({ type: 'user.signup', userId: '123' });

// Resume existing execution
await worker.publish(
  { type: 'user.signup', userId: '123' },
  undefined,
  { executionId: 'exec-123', taskId: 'send-email' }
);
```

### `worker.configure(options)`

Updates worker configuration at runtime.

**Parameters:**
- `options` - Partial worker options to update

```typescript
worker.configure({
  logger: debugWorkerLogger,
  onError: (error) => console.error('New error handler:', error)
});
```

## Stores

### `createMemoryStore()`

In-memory store for development and testing.

**Returns:** `MemoryStore & WorkerStore`

```typescript
import { createMemoryStore } from 'idioteque';

const store = createMemoryStore();

// Additional methods for testing
store.getState(); // Get current state
store.setState(state); // Set state
store.clear(); // Clear all data
```

### `createFileSystemStore(storeDir)`

File-based store for development.

**Parameters:**
- `storeDir: string` - Directory path for storing files

**Returns:** `WorkerStore`

```typescript
import { createFileSystemStore } from 'idioteque';

const store = createFileSystemStore('./worker-data');
```

## Dispatchers

### `createDangerousFetchDispatcher(options)`

HTTP-based dispatcher for development. **Does not guarantee delivery.**

**Parameters:**
- `options.mountUrl: string` - URL where worker is mounted

**Returns:** `WorkerDispatcher & { mount: Function }`

```typescript
import { createDangerousFetchDispatcher } from 'idioteque';

const dispatcher = createDangerousFetchDispatcher({
  mountUrl: 'http://localhost:3000/api/worker'
});

// Mount for API routes
export const { POST } = dispatcher.mount(worker, { functions: [fn] });
```

## Loggers

### `defaultWorkerLogger`

Silent logger (no output).

### `debugWorkerLogger`

Console logger for development.

```typescript
import { debugWorkerLogger } from 'idioteque';

const worker = createWorker({
  logger: debugWorkerLogger,
  // ...
});
```

## Execution Modes

### ISOLATED (Default)

Each task triggers a new event publication. Best for distributed processing.

```typescript
worker.mount({
  functions: [fn],
  executionMode: 'ISOLATED'
});
```

### UNTIL_ERROR

Tasks are queued and executed sequentially in a single execution context. Best for batch processing.

```typescript
worker.mount({
  functions: [fn],
  executionMode: 'UNTIL_ERROR'
});
```

## Error Handling

### WorkerInterrupt

Special exception used internally for flow control. Do not catch this exception.

```typescript
import { WorkerInterrupt } from 'idioteque';

// DON'T DO THIS
try {
  await execute('task', () => doSomething());
} catch (err) {
  if (err instanceof WorkerInterrupt) {
    // This will break resumability
  }
}
```

### InvalidEventError

Thrown when event validation fails.

```typescript
import { InvalidEventError } from 'idioteque';

try {
  await worker.publish({ invalid: 'event' });
} catch (err) {
  if (err instanceof InvalidEventError) {
    console.error('Invalid event:', err.message);
  }
}
```

## TypeScript Support

Full TypeScript support with event type inference:

```typescript
const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user.signup'), userId: z.string() }),
  z.object({ type: z.literal('email.send'), to: z.string(), subject: z.string() })
]);

const worker = createWorker({ eventsSchema: EventSchema, /* ... */ });

// Event parameter is automatically typed
worker.createFunction('handler', 'user.signup', async (event) => {
  event.userId; //  string
  event.to;     // L Property 'to' does not exist
});
```

## License

MIT