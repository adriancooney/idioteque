# @idioteque/qstash

QStash dispatcher implementation for idioteque workers. Provides reliable, guaranteed message delivery using Upstash QStash service.

## Features

- ✅ **Guaranteed delivery** - QStash ensures messages are delivered even if your app is down
- 🔄 **Automatic retries** - Configurable retry logic with exponential backoff
- 💀 **Dead letter queue** - Failed messages are preserved for debugging
- 🔗 **Webhooks** - Built-in webhook handling for Next.js applications
- 📊 **Monitoring** - Full observability through Upstash dashboard
- ⚡ **Reliable** - Built on Upstash's managed infrastructure

## Installation

```bash
npm install @idioteque/qstash
```

## Usage

```typescript
import { createQStashDispatcher } from '@idioteque/qstash';
import { createWorker } from 'idioteque';

const dispatcher = createQStashDispatcher({
  mountUrl: `https://${process.env.HOST}/api/worker`,
  token: process.env.QSTASH_TOKEN,
  retries: 3
});

const worker = createWorker({
  dispatcher,
  // ... other options
});

// Mount the worker to handle incoming requests
export const { POST } = dispatcher.mount(worker, {
  functions: [yourFunction],
});
```

## API

### `createQStashDispatcher(options)`

Creates a QStash-based dispatcher for reliable message delivery.

**Parameters:**
- `options.mountUrl: string` - The URL where your worker is mounted (e.g., `https://yourapp.com/api/worker`)
- `options.token: string` - Your QStash authentication token
- `options.retries?: number` - Number of retry attempts (default: 3)

**Returns:** `WorkerDispatcher<{ retries: number }> & { mount: Function }`

#### Methods

##### `dispatch(data, options?)`

Publishes a message to QStash for processing.

**Parameters:**
- `data: string` - Serialized event data
- `options?: { retries: number }` - Override retry count for this message

**Returns:** `Promise<void>`

##### `mount(worker, options)`

Creates a Next.js API route handler for processing QStash webhooks.

**Parameters:**
- `worker: Worker<T>` - The idioteque worker instance
- `options: WorkerMountOptions` - Worker mounting configuration

**Returns:** `{ POST: (request: Request) => Promise<Response> }`

## Configuration

### Environment Variables

Set up the following environment variables:

```env
QSTASH_TOKEN=your_qstash_token_here
```

### QStash Setup

1. Sign up for [Upstash QStash](https://upstash.com/)
2. Create a new QStash token
3. Configure your webhook endpoint URL

## Examples

### Basic Setup

```typescript
import { createQStashDispatcher } from '@idioteque/qstash';
import { createWorker } from 'idioteque';

const dispatcher = createQStashDispatcher({
  mountUrl: `https://${process.env.VERCEL_URL}/api/worker`,
  token: process.env.QSTASH_TOKEN!,
});

const worker = createWorker({
  eventsSchema: EventSchema,
  store: redisStore,
  dispatcher,
});
```

### API Route (Next.js App Router)

```typescript
// app/api/worker/route.ts
import { dispatcher, worker } from '@/lib/worker';
import { processUserSignup } from '@/functions/user';

export const { POST } = dispatcher.mount(worker, {
  functions: [processUserSignup],
});
```

### Custom Retry Configuration

```typescript
const dispatcher = createQStashDispatcher({
  mountUrl: `https://${process.env.VERCEL_URL}/api/worker`,
  token: process.env.QSTASH_TOKEN!,
  retries: 5, // Default retry count
});

// Override retries for specific events
await worker.publish({
  type: 'critical-task',
  data: 'important'
}, { retries: 10 });
```


## Error Handling

The dispatcher will throw an error if QStash returns a non-200 response:

```typescript
try {
  await worker.publish({ type: 'my-event' });
} catch (error) {
  console.error('Failed to dispatch:', error.message);
}
```

## License

MIT