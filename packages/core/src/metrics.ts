import type { WorkerMetrics } from "./types";

export const defaultWorkerMetrics = {
  async timing(
    _metricName: string,
    _tags: Record<string, string>,
    _timings: [startTime: number, endTime: number]
  ): Promise<void> {},

  async increment(
    _metricName: string,
    _tags: Record<string, string>
  ): Promise<void> {},
} satisfies WorkerMetrics;
