# ⚡ belts

TypeScript-first background job processing with type safety and resumable execution.

## 🚀 Installation

```bash
npm install belts
```

## Quick Example

```typescript
import { createWorker } from 'belts';
import { z } from 'zod';

const EventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send-email'), email: z.string() }),
  z.object({ type: z.literal('resize-image'), imageUrl: z.string() }),
]);

const worker = createWorker({
  url: 'https://api.example.com/worker',
  eventsSchema: EventSchema,
});

const emailFunction = worker.createFunction(
  'send-email-handler',
  'send-email',
  async (event, { execute }) => {
    const template = await execute('load-template', () => 
      loadEmailTemplate()
    );
    
    await execute('send-email', () => 
      sendEmail(event.email, template)
    );
  }
);

const mount = worker.mount({ functions: [emailFunction] });
export const POST = mount.POST;

// Publish events
await worker.publish({ type: 'send-email', email: 'user@example.com' });
```

## 🏗️ Core Concepts

- **Worker**: Event router with type safety
- **Functions**: Stateless event handlers
- **Execute**: Reliable, resumable operations within functions
- **Dispatcher**: Event delivery (HTTP, Redis, SQS, QStash)
- **Executor**: Function execution with error handling
- **Store**: State persistence for multi-step workflows

## 📖 API Reference

### `createWorker<T>(options)`

Creates a worker instance that processes events of type `T`.

#### Parameters

- **`url`** `string` - The HTTP endpoint where worker functions are mounted
- **`eventsSchema`** `StandardSchemaV1<T>` - Schema validator for events (Zod, Yup, etc.)
- **`concurrency?`** `number` - Max concurrent function executions (default: 3)
- **`onError?`** `(error: unknown) => Promise<unknown> | unknown` - Global error handler
- **`metrics?`** `WorkerMetrics` - Custom metrics implementation
- **`logger?`** `WorkerLogger` - Custom logger implementation
- **`executor?`** `WorkerExecutor` - Custom function executor
- **`dispatcher?`** `WorkerDispatcher` - Custom event dispatcher
- **`store?`** `WorkerStore` - Persistence layer for multi-step workflows

#### Returns

`Worker<T>` - Worker instance with methods for creating functions and publishing events

#### Example

```typescript
const worker = createWorker({
  url: 'https://api.example.com/worker',
  eventsSchema: MyEventSchema,
  concurrency: 5,
  onError: async (error) => {
    console.error('Worker error:', error);
    await logToSentry(error);
  },
});
```

### `worker.createFunction(id, eventFilter, handler)`

Creates a function that processes specific event types.

#### Parameters

- **`id`** `string` - Unique identifier for this function
- **`eventFilter`** - Event matcher (see options below)
- **`handler`** `WorkerFunctionHandler<T>` - Function that processes the event

#### Event Filter Options

**String matcher:**
```typescript
worker.createFunction('my-func', 'event-type', handler)
```

**Array of event types:**
```typescript
worker.createFunction('my-func', ['type1', 'type2'], handler)
```

**Custom filter function:**
```typescript
worker.createFunction(
  'my-func',
  (event): event is SpecificEvent => event.type === 'specific' && event.priority === 'high',
  handler
)
```

#### Handler Function

The handler receives two parameters:

- **`event`** `T` - The validated event object
- **`context`** `object` - Execution context with:
  - **`executionId`** `string` - Unique ID for this execution
  - **`timestamp`** `number` - Execution start timestamp
  - **`execute`** `function` - Reliable execution helper (see below)

#### The `execute` Helper

The `execute` function provides reliable, resumable operations:

```typescript
const result = await execute(key, callback)
```

- **`key`** `string` - Unique identifier for this operation step
- **`callback`** `() => Promise<T>` - Operation to execute
- **Returns** `Promise<T>` - Result of the operation

The `execute` helper automatically handles:
- Caching results to avoid re-execution
- Resuming from failed steps
- Dispatching continuation events

#### Example

```typescript
const processOrderFunction = worker.createFunction(
  'process-order',
  'order-created',
  async (event, { execute }) => {
    // Each step is cached and resumable
    const inventory = await execute('check-inventory', () =>
      checkInventory(event.productId)
    );
    
    const payment = await execute('charge-payment', () =>
      chargePayment(event.paymentMethod, event.amount)
    );
    
    await execute('ship-order', () =>
      shipOrder(event.orderId, inventory, payment)
    );
  }
);
```

### `worker.mount(options)`

Mounts functions and returns HTTP handlers.

#### Parameters

- **`functions`** `WorkerFunction[]` - Array of functions to mount
- **`sync?`** `boolean` - If true, executes functions synchronously (default: false)

#### Returns

Object with:
- **`execute`** `(event, context?) => Promise<void>` - Direct execution method
- **`POST`** `(request: Request) => Promise<Response>` - HTTP handler for frameworks

#### Example

```typescript
const mount = worker.mount({
  functions: [emailFunction, imageFunction, orderFunction],
  sync: false // Use async execution with streaming responses
});

// Use in Next.js
export const POST = mount.POST;

// Or execute directly
await mount.execute({ type: 'send-email', email: 'test@example.com' });
```

### `worker.publish(event, dispatcherOptions?)`

Publishes an event for processing.

#### Parameters

- **`event`** `T` - Event object matching your schema
- **`dispatcherOptions?`** `any` - Options passed to the dispatcher

#### Returns

`Promise<void>` - Resolves when event is dispatched

#### Example

```typescript
// Basic publishing
await worker.publish({
  type: 'process-image',
  imageUrl: 'https://example.com/image.jpg'
});

// With dispatcher-specific options
await worker.publish(
  { type: 'send-email', email: 'user@example.com' },
  { delay: 300, retries: 3 } // QStash options
);
```

### `worker.configure(options)`

Updates worker configuration after creation.

#### Parameters

- **`options`** `Partial<WorkerOptions<T>>` - Configuration options to update

#### Example

```typescript
worker.configure({
  concurrency: 10,
  onError: newErrorHandler,
});
```

### `worker.getOptions()`

Returns current worker configuration.

#### Returns

`WorkerOptions<T>` - Current configuration

## 🔌 Provider Integrations

### Redis Store

Enables multi-step workflows with Redis persistence:

```typescript
import { createRedisStore } from '@househunter/worker-redis';

const worker = createWorker({
  url: 'https://api.example.com/worker',
  eventsSchema: EventSchema,
  store: createRedisStore({
    url: 'redis://localhost:6379',
    keyPrefix: 'worker:',
    ttl: 3600 // 1 hour
  })
});
```

### QStash Dispatcher

Reliable event delivery via QStash:

```typescript
import { createQStashDispatcher } from '@househunter/worker-qstash';

const worker = createWorker({
  url: 'https://api.example.com/worker',
  eventsSchema: EventSchema,
  dispatcher: createQStashDispatcher({
    token: process.env.QSTASH_TOKEN,
    baseUrl: 'https://api.example.com',
    retries: 3,
    delay: '10s'
  })
});
```

### Custom Metrics

Integrate with monitoring services:

```typescript
import { createDatadogMetrics } from '@househunter/worker-datadog';

const worker = createWorker({
  url: 'https://api.example.com/worker',
  eventsSchema: EventSchema,
  metrics: createDatadogMetrics({
    apiKey: process.env.DD_API_KEY,
    tags: ['env:production', 'service:worker']
  })
});
```

## 🧪 Testing

### Basic Testing

```typescript
import { setupWorker } from 'belts/testing';
import { emailFunction } from './functions';

describe('Email Function', () => {
  it('sends emails correctly', async () => {
    const mockSend = jest.fn();
    jest.mock('./email-service', () => ({ sendEmail: mockSend }));
    
    const { mount } = setupWorker(worker, [emailFunction]);
    
    await mount.execute({
      type: 'send-email',
      email: 'test@example.com'
    });
    
    expect(mockSend).toHaveBeenCalledWith('test@example.com', expect.any(String));
  });
});
```

### Testing Multi-Step Functions

```typescript
it('handles multi-step workflows', async () => {
  const mockStore = createMockStore();
  const testWorker = createWorker({
    url: 'https://test.com/worker',
    eventsSchema: EventSchema,
    store: mockStore
  });
  
  const { mount } = setupWorker(testWorker, [complexFunction]);
  
  // Execute specific step
  await mount.execute(event, {
    executionId: 'test-123',
    timestamp: Date.now(),
    functionId: 'complex-function',
    executionTarget: 'step-1'
  });
  
  expect(mockStore.getExecutionTaskResult('test-123', 'step-1'))
    .toBe('expected-result');
});
```

### Testing Error Handling

```typescript
it('handles function errors', async () => {
  const errorFunction = worker.createFunction(
    'error-func',
    'error-event',
    async () => { throw new Error('Test error'); }
  );
  
  const { mount } = setupWorker(worker, [errorFunction]);
  
  const response = await mount.POST(new Request('https://test.com', {
    method: 'POST',
    body: JSON.stringify({ event: { type: 'error-event' } })
  }));
  
  expect(response.status).toBe(500);
  const error = await response.json();
  expect(error.error).toBe(true);
  expect(error.message).toBe('Test error');
});
```

## 🚀 Framework Integration

### Next.js App Router

```typescript
// app/api/worker/route.ts
import { worker, allFunctions } from '@/lib/worker';

const mount = worker.mount({ functions: allFunctions });
export const POST = mount.POST;
```

### Express.js

```typescript
import express from 'express';
import { worker, allFunctions } from './worker';

const app = express();
const mount = worker.mount({ functions: allFunctions });

app.post('/worker', async (req, res) => {
  const response = await mount.POST(new Request('http://localhost:3000/worker', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req.body)
  }));
  
  res.status(response.status).json(await response.json());
});
```

### Serverless (Vercel/Netlify/AWS Lambda)

```typescript
export default async function handler(req: any, res: any) {
  const mount = worker.mount({ functions: allFunctions });
  const response = await mount.POST(new Request(`https://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: JSON.stringify(req.body)
  }));
  
  res.status(response.status).json(await response.json());
}
```

## 📄 License

MIT