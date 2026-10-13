import http from 'node:http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { createApp } from './app.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';
import { createSocketServer } from './sockets/index.js';
import { setRealtimeServer } from './sockets/realtime.js';

async function main() {
  await connectDatabase(env.MONGODB_URI);
  await connectRedis();

  const { app, sessionMiddleware } = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server, sessionMiddleware);

  server.listen(env.PORT, () => logger.info(`Fluxora API listening on :${env.PORT} (${env.NODE_ENV})`));
  await startJobs();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    const force = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);
    force.unref();
    try {
      await stopJobs();
      setRealtimeServer(null);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await disconnectRedis();
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
