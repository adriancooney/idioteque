# Idioteque Next.js QStash Example

This example demonstrates how to use idioteque with QStash for reliable background job processing in a Next.js application.

## Features

- **Background Workers**: Process orders asynchronously using idioteque workers
- **QStash Integration**: Reliable job delivery with automatic retries via Upstash QStash
- **Redis State**: Persistent job state management with Upstash Redis
- **Next.js API Routes**: Worker endpoints for processing jobs

## Environment Variables

Create a `.env.local` file with the following variables:

```bash
# Upstash Redis
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token

# QStash
QSTASH_TOKEN=your_qstash_token
QSTASH_MOUNT_URL=https://your-app.vercel.app/api/worker
```

## Getting Started

First, install dependencies and run the development server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

## How it Works

1. **Job Creation**: Orders are created through the web interface
2. **QStash Dispatch**: Jobs are sent to QStash for reliable delivery
3. **Worker Processing**: QStash delivers jobs to your `/api/worker` endpoint
4. **Background Functions**: Process payments, send confirmations, update inventory

## Learn More

- [Idioteque Documentation](https://github.com/your-repo/idioteque)
- [QStash Documentation](https://upstash.com/docs/qstash)
- [Next.js Documentation](https://nextjs.org/docs)
