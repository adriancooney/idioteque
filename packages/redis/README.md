# @idioteque/redis

Redis store implementation for idioteque worker library.

## Installation

```bash
npm install @idioteque/redis
# or
pnpm add @idioteque/redis
```

## Usage

```typescript
import { createRedisStore } from '@idioteque/redis';
import { Redis } from '@upstash/redis';
import { createWorker } from 'idioteque';

const redis = Redis.fromEnv({ automaticDeserialization: false });
const store = createRedisStore(redis);

const worker = createWorker({
  eventsSchema: YourEventsSchema,
  store,
  dispatcher: yourDispatcher,
});
```

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

## Redis Interface

The `createRedisStore` function accepts any Redis client that implements:

```typescript
interface RedisImpl {
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<unknown>;
  hset(key: string, kv: { [field: string]: string }): Promise<number>;
  hget(key: string, field: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}
```

Compatible with:
- `@upstash/redis`
- `ioredis` 
- `redis` (node-redis)
- Any Redis client with the above interface