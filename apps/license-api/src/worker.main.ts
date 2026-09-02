/**
 * Dedicated queue-worker process. Boots Nest providers (queue processors, notifications)
 * without binding an HTTP port. Requires REDIS_URL for durable job consumption.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { QueueService } from './queue/queue.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableShutdownHooks();

  const queue = app.get(QueueService);
  if (!queue.isRedisEnabled()) {
    logger.error(
      'WORKER_ONLY process requires REDIS_URL. Exiting — inline mode belongs in the API process.',
    );
    await app.close();
    process.exit(1);
  }

  logger.log(`Queue worker online (mode=${queue.getMode()})`);

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal} — shutting down worker`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
