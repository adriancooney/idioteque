# @idioteque/vercel-queue

Vercel Queue dispatcher implementation for idioteque workers. Provides reliable message queuing using Vercel's managed queue service.

## Features

- 🏗️ **Managed infrastructure** - No need to manage queue infrastructure
- 📈 **Automatic scaling** - Scales with your Vercel deployments
- 📊 **Built-in monitoring** - Queue metrics available in Vercel dashboard
- 🔌 **Simple integration** - Works seamlessly with Next.js applications
- ✅ **Reliable delivery** - Messages are guaranteed to be processed
- 🎯 **Namespace support** - Organize queues with custom namespaces

## Installation

```bash
npm install @idioteque/vercel-queue
```

## Usage

```typescript
import { createVercelQueueDispatcher } from '@idioteque/vercel-queue';
import { createWorker } from 'idioteque';

const dispatcher = createVercelQueueDispatcher({
  namespace: 'my-app'
});

const worker = createWorker({
  dispatcher,
  // ... other options
});

// Mount the worker to handle queue messages
export const { POST } = dispatcher.mount(worker, {
  functions: [yourFunction],
});
```

## API

### `createVercelQueueDispatcher(options)`

Creates a Vercel Queue-based dispatcher for reliable message queuing.

**Parameters:**
- `options.namespace: string` - Unique namespace for your queue messages

**Returns:** `WorkerDispatcher & { mount: Function }`

#### Methods

##### `dispatch(data)`

Sends a message to the Vercel Queue for processing.

**Parameters:**
- `data: string` - Serialized event data

**Returns:** `Promise<void>`

##### `mount(worker, options)`

Creates a Vercel Queue callback handler for processing messages.

**Parameters:**
- `worker: Worker<T>` - The idioteque worker instance
- `options: WorkerMountOptions` - Worker mounting configuration

**Returns:** `{ POST: ReturnType<typeof handleCallback> }`

## Configuration

### Vercel Queue Setup

1. Install the Vercel Queue integration on your Vercel project
2. Configure your queue handlers in your API routes
3. Add queue configuration to your `vercel.json`
4. Deploy your application

### vercel.json Configuration

You need to configure your queue triggers in `vercel.json`:

```json
{
  "functions": {
    "app/api/worker/route.ts": {
      "experimentalTriggers": [
        {
          "type": "queue/v1beta",
          "topic": "idioteque-message-your-namespace",
          "consumer": "worker",
          "retryAfterSeconds": 300
        }
      ]
    }
  }
}
```

**Important:** The `topic` must match the pattern `idioteque-message-{namespace}` where `{namespace}` is the namespace you specified when creating the dispatcher.

For example, if you create a dispatcher with:
```typescript
const dispatcher = createVercelQueueDispatcher({
  namespace: 'ecommerce'
});
```

Your `vercel.json` should have:
```json
{
  "functions": {
    "app/api/worker/route.ts": {
      "experimentalTriggers": [
        {
          "type": "queue/v1beta",
          "topic": "idioteque-message-ecommerce",
          "consumer": "worker",
          "retryAfterSeconds": 300
        }
      ]
    }
  }
}
```

### Environment Variables

Vercel Queue automatically configures the necessary environment variables when deployed to Vercel.

## Examples

### Basic Setup

```typescript
import { createVercelQueueDispatcher } from '@idioteque/vercel-queue';
import { createWorker } from 'idioteque';

const dispatcher = createVercelQueueDispatcher({
  namespace: 'user-processing'
});

const worker = createWorker({
  eventsSchema: EventSchema,
  store: redisStore,
  dispatcher,
});
```

### API Route

```typescript
// app/api/worker/route.ts
import { dispatcher, worker } from '@/lib/worker';
import { processUserSignup, sendEmail } from '@/functions';

export const { POST } = dispatcher.mount(worker, {
  functions: [processUserSignup, sendEmail],
});
```

### Multiple Namespaces

```typescript
// User processing queue
const userDispatcher = createVercelQueueDispatcher({
  namespace: 'user-events'
});

// Email processing queue
const emailDispatcher = createVercelQueueDispatcher({
  namespace: 'email-events'
});

const userWorker = createWorker({
  dispatcher: userDispatcher,
  // ... other options
});

const emailWorker = createWorker({
  dispatcher: emailDispatcher,
  // ... other options
});
```


## Queue Message Structure

Messages are automatically formatted with the following structure:

```typescript
{
  data: string // Your serialized event data
}
```

The queue name follows the pattern: `idioteque-message-${namespace}`

## Deployment

When deploying to Vercel:

1. Ensure you have the Vercel Queue integration installed
2. Your API routes will automatically be configured as queue handlers
3. Messages will be processed according to your queue configuration

## Development

For local development, Vercel Queue will work in development mode when using `vercel dev`.

## License

MIT