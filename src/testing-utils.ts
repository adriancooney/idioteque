import { createServer } from "node:http";
import { syncDispatcher } from "./dispatcher";
import type {
  Worker,
  WorkerFunction,
  WorkerMount,
  WorkerOptions,
} from "./types";

export function setupWorker<T extends { type: string }>(
  worker: Worker<T>,
  functions: WorkerFunction[]
) {
  let mount: WorkerMount<T>;
  let _workerOptions: WorkerOptions<T>;

  const server = createServer((req, res) => {
    if (!mount) {
      res.statusCode = 500;
      res.end();
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const response = await mount.POST(
        new Request("https://localhost:8546", {
          method: "POST",
          body: Buffer.concat(chunks).toString(),
        })
      );

      res.statusCode = response.status;
      res.write(await response.text());
      res.end();
    });
  });

  beforeAll(() => {
    _workerOptions = worker.getOptions();
    mount = worker.mount({ functions, sync: true });
    server.listen(8546);
    worker.configure({
      url: "http://localhost:8546",
      concurrency: 1,
      dispatcher: syncDispatcher,
    });
  });

  afterAll(() => {
    worker.configure(_workerOptions);
    server.close();
  });
}
