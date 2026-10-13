import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getRedis } from '../config/redis.js';
import { runExceptionScan } from '../modules/alerts/alert.service.js';
import { pollActiveTracking, purgeExpiredCarrierTracking } from '../modules/tracking/tracking.service.js';

/**
 * Background jobs:
 *  - tracking-poll:   refresh automated (simulated / live) tracking for in-flight shipments
 *  - exception-scan:  evaluate exception rules and open / auto-resolve alerts
 *  - tracking-purge:  delete carrier tracking data the carrier's terms say not to keep
 *
 * With Redis: BullMQ repeatable jobs (deduplicated across instances, retries with
 * exponential backoff). Without Redis: in-process intervals with an overlap guard.
 */
type JobName = 'tracking-poll' | 'exception-scan' | 'tracking-purge';

const handlers: Record<JobName, () => Promise<unknown>> = {
  'tracking-poll': () => pollActiveTracking(),
  'exception-scan': () => runExceptionScan(),
  'tracking-purge': () => purgeExpiredCarrierTracking(),
};

const intervals: Record<JobName, number> = {
  'tracking-poll': env.TRACKING_POLL_INTERVAL_SECONDS * 1000,
  'exception-scan': env.EXCEPTION_SCAN_INTERVAL_SECONDS * 1000,
  'tracking-purge': 6 * 60 * 60 * 1000,
};

let stopFns: (() => Promise<void>)[] = [];

async function startBullMq(): Promise<void> {
  const redis = getRedis()!;
  const connection = redis.duplicate() as unknown as ConnectionOptions;
  const queue = new Queue<Record<string, never>, unknown, JobName>('fluxora-jobs', { connection });
  for (const name of Object.keys(handlers) as JobName[]) {
    await queue.upsertJobScheduler(
      name,
      { every: intervals[name] },
      { name, data: {}, opts: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 500 } },
    );
  }
  const worker = new Worker<Record<string, never>, unknown, JobName>(
    'fluxora-jobs',
    async (job) => {
      const result = await handlers[job.name]();
      logger.debug({ job: job.name, result }, 'Job completed');
      return result;
    },
    { connection: redis.duplicate() as unknown as ConnectionOptions, concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ job: job?.name, attempts: job?.attemptsMade, err: err.message }, 'Job failed'));
  stopFns.push(async () => {
    await worker.close();
    await queue.close();
  });
  logger.info('Background jobs scheduled with BullMQ');
}

function startIntervals(): void {
  for (const name of Object.keys(handlers) as JobName[]) {
    let running = false;
    const tick = async () => {
      if (running) return; // never overlap runs of the same job
      running = true;
      try {
        const result = await handlers[name]();
        logger.debug({ job: name, result }, 'Job completed');
      } catch (err) {
        logger.error({ job: name, err: (err as Error).message }, 'Job failed');
      } finally {
        running = false;
      }
    };
    const handle = setInterval(tick, intervals[name]);
    handle.unref();
    setTimeout(tick, 5_000).unref();
    stopFns.push(async () => clearInterval(handle));
  }
  logger.info('Background jobs scheduled in-process (no Redis)');
}

export async function startJobs(): Promise<void> {
  if (!env.JOBS_ENABLED) {
    logger.info('Background jobs disabled (JOBS_ENABLED=false)');
    return;
  }
  if (getRedis()) {
    try {
      await startBullMq();
      return;
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'BullMQ start failed — falling back to in-process jobs');
    }
  }
  startIntervals();
}

export async function stopJobs(): Promise<void> {
  const fns = stopFns;
  stopFns = [];
  await Promise.allSettled(fns.map((f) => f()));
}
