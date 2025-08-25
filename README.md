# idioteque
A TypeScript-first async worker library with resumable execution. Build fault-tolerant workflows that survive failures and restart exactly where they left off.

## Features
- 🔄 **Resumable execution** - Tasks can be interrupted and resumed from where they left off
- 🛡️ **Distributed, fault tolerant** - Execution state is persisted and recoverable
- 🌳 **Hierarchical task execution** - Support for nested tasks with path-based organization
- ⚙️ **Flexible execution modes** - Choose between isolated or sequential execution
- 🔒 **Type-safe events** - Full TypeScript support with schema validation
- ✨ **Simple API** - Clean, intuitive interface for defining workflows

## Quick start

### 1. Install idioteque
```bash
npm install idioteque @idioteque/redis @idioteque/qstash
```

### 2. Create your worker
```typescript
// /lib/worker.ts
import { z } from 'zod';
import { Redis } from 'ioredis';
import { createWorker } from 'idioteque';
import { createRedisStore } from '@idioteque/redis';
import { createQStashDispatcher } from '@idioteque/qstash';

// Define your event schema
const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user.signup'), userId: z.string() }),
  z.object({ type: z.literal('email.send'), to: z.string(), subject: z.string() })
]);

// Create your dispatcher - uses qstash to guarantee delivery and execution
export const dispatcher = createQStashDispatcher({
  mountUrl: `https://${process.env.VERCEL_URL}/api/worker`,
  token: process.env.QSTASH_TOKEN
})

// Create worker with Redis store for state
export const worker = createWorker({
  eventsSchema: EventSchema,
  store: createRedisStore(new Redis(process.env.REDIS_URL)),
  dispatcher
});
```

### 2. Define a function
```typescript
// /lib/functions/process-user-signup.ts
import { worker } from '@/lib/worker';

const processUserSignup = worker.createFunction(
  'process-user-signup',
  'user.signup',
  async (event, { execute }) => {
    const user = await execute('fetch-user', () => getUserById(event.userId));

    // Conditional logic with resumable execution
    if (user.isFirstTime) {
      await execute('send-welcome', () =>
        sendEmail(user.email, 'Welcome!')
      );
    }

    // Loop with resumable tasks
    for (let i = 0; i < user.friends.length; i++) {
      await execute(`notify-friend-${i}`, () =>
        notifyFriend(user.friends[i], user.name)
      );
    }
  }
);
```

### 4. Mount the worker
```typescript
// /app/api/worker/route.ts
import { processUserSignup } from '@/lib/functions/process-user-signup';
import { dispatcher } from '@/lib/worker';

export const { POST } = dispatcher.mount(worker, {
  functions: [processUserSignup],
});
```

### 5. Trigger a function
```typescript
import { worker } from '@/lib/worker';

// Publish an event to trigger the function
await worker.publish({
  type: 'user.signup',
  userId: 'user-123'
});
```

## Examples

Complete example applications demonstrating different idioteque configurations:

### 📦 [QStash + Next.js Example](./examples/idioteque-nextjs-qstash)
Full e-commerce workflow using QStash for guaranteed message delivery. Features:
- Order processing with payment, inventory, and email notifications
- Upstash QStash integration for reliable job delivery
- Redis state persistence
- Resumable multi-step workflows

### 🚀 [Vercel Queue + Next.js Example](./examples/idioteque-nextjs-vercel-queue)
Same e-commerce workflow using Vercel's managed queue system. Features:
- Vercel Queue integration for seamless deployment
- Automatic scaling with your Vercel functions
- Built-in monitoring and observability
- Zero infrastructure management

Both examples show identical business logic with different infrastructure choices - perfect for comparing approaches or migrating between systems.

## Concepts

### Worker
The central orchestrator that manages event processing, task execution, and state persistence. Created with `createWorker()` and configured with stores, dispatchers, and event schemas.

### Event
Type-safe messages that trigger function execution. Events have a `type` field and are validated against your schema before processing.

### Function
Event handlers that process specific event types. Functions can execute nested tasks using the hierarchical task system, with automatic state persistence and resumability.

### Store
Persistence layer for execution state and task results. Enables fault tolerance and resumable execution by tracking:
- Active executions
- Task progress and results
- Execution metadata

### Dispatcher
Transport mechanism for event delivery. Handles event publishing and routing to ensure reliable message delivery across your distributed system.

### Dispatchers
- **Dangerous fetch dispatcher** - HTTP-based dispatcher for development. Does not guarantee execution.
- **QStash** - Upstash's message queue service. Guarantees execution. [`@idioteque/qstash`](./packages/qstash)
- **Vercel queues** - Vercel's managed queue system. Guarantees execution. [`@idioteque/vercel-queue`](./packages/vercel-queue)

### Store
- **Filestore** - Local filesystem storage for development.
- **Dangerous memory store** - In-memory storage (non-persistent) used for testing.
- **Redis store** - Redis-based storage (works with Upstash). [`@idioteque/redis`](./packages/redis)

## Testing
idioteque treats testing as a first-class citizen. Your worker executes directly in tests with no external dependencies required.

The `setupWorker` API provides a test-friendly environment that mocks external services while preserving full execution semantics including task hierarchy and caching.

Example:
```typescript
import { setupWorker } from 'idioteque/testing';
import { worker, functions } from './worker';

const worker = setupWorker(worker, functions);

test('workflow execution', async () => {
  // Executes function within test and any other publishes
  await worker.publish({
    type: "my-event"
  });
});
```

## API
- **`createWorker`** - Creates a new worker instance with specified configuration
- **`worker.createFunction`** - Defines event handlers with type-safe event filtering
- **`worker.mount`** - Registers functions and returns execution interface
- **`worker.publish`** - Publishes events to trigger function execution
- **`worker.configure`** - Updates worker configuration at runtime

#### Why is it called `idioteque`?
It's named after a great Radiohead song because all reasonable, description names and acyronyms of those names are taken on `npm`.