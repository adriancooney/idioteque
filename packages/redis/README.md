# @idioteque/redis

Redis store implementation for idioteque workers. Provides persistent, distributed storage for execution state and task results using Redis.

## Features

- 💾 **Persistent storage** - Execution state survives application restarts
- 🌐 **Distributed** - Multiple worker instances can share the same Redis store
- 🧹 **Automatic cleanup** - Optional TTL support to prevent storage bloat
- 📦 **JSON serialization** - Automatic serialization/deserialization of task results
- 🔧 **Multi-client support** - Compatible with ioredis, node-redis, and Upstash Redis
- ⚠️ **Error handling** - Detailed error messages for debugging serialization issues

## Installation

```bash
npm install @idioteque/redis ioredis
```

## Usage

```typescript
import { Redis } from 'ioredis';
import { createRedisStore } from '@idioteque/redis';
import { createWorker } from 'idioteque';

const redis = new Redis(process.env.REDIS_URL);
const store = createRedisStore(redis, { ttl: 86400000 }); // 24 hours

const worker = createWorker({
  store,
  // ... other options
});
```

## API

### `createRedisStore(redis, options?)`

Creates a Redis-backed store for idioteque workers.

**Parameters:**
- `redis: RedisImpl` - Redis client instance (supports ioredis, node-redis, or any Redis-compatible client)
- `options?: { ttl?: number }` - Optional configuration
  - `ttl` - Time-to-live for keys in milliseconds (default: no expiration)

**Returns:** `WorkerStore`

#### Supported Redis Clients

The store accepts any Redis client that implements the `RedisImpl` interface:

```typescript
interface RedisImpl {
  set(key: string, value: string): Promise<any>;
  get(key: string): Promise<unknown | null>;
  hset(key: string, kv: { [field: string]: string }): Promise<any>;
  hget(key: string, field: string): Promise<unknown | null>;
  hdel(key: string, field: string): Promise<any>;
  hgetall(key: string): Promise<Record<string, unknown> | string[] | null>;
  del(key: string): Promise<any>;
  expire(key: string, seconds: number): Promise<any>;
}
```

#### Examples

**With ioredis:**
```typescript
import { Redis } from 'ioredis';
import { createRedisStore } from '@idioteque/redis';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

const store = createRedisStore(redis);
```

**With Upstash Redis:**
```typescript
import { Redis } from '@upstash/redis';
import { createRedisStore } from '@idioteque/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const store = createRedisStore(redis);
```

**With TTL (automatic cleanup):**
```typescript
const store = createRedisStore(redis, {
  ttl: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
});
```


## Redis Key Structure

The store uses the following Redis key patterns:

- `{executionId}` - Tracks active executions
- `{executionId}-transactions` - Hash of in-progress tasks
- `{executionId}-results` - Hash of completed task results

All keys automatically expire based on the configured TTL (if provided).

## Development

### Running Redis for Tests

This package includes a Docker Compose configuration for running Redis during development:

```bash
# Start Redis container
pnpm redis:up

# Run tests (requires Redis to be running)
pnpm test

# Run tests with automatic Redis container management
pnpm test:redis

# Stop Redis container
pnpm redis:down

# View Redis logs
pnpm redis:logs
```

### Requirements

- Docker and Docker Compose for running tests
- Node.js 16+
- TypeScript 5.0+