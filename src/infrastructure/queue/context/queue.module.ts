import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PROMPT_QUEUE } from '../../../domain/context/prompt-queue';
import { BullMqPromptQueue } from './bullmq-prompt-queue';
import { GATHER_TIMEOUT_QUEUE_NAME } from './bullmq-gather-timeout.scheduler';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          // Strict `tls: {}` (default rejectUnauthorized: true) on purpose:
          // Upstash presents a properly-signed cert, so verify it. This
          // deliberately differs from POSTGRES_SSL, which relaxes
          // rejectUnauthorized for Neon's unverifiable CA — only the parsing
          // mirrors POSTGRES_SSL, not the TLS options shape.
          ...(config.get<boolean>('REDIS_TLS') ? { tls: {} } : {}),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'planning' }),
    // RabbitMQ context-engine transport's no-result timeout
    // (docs/contracts/context-engine.md §4) — a durable BullMQ delayed job,
    // not a bare setTimeout. Registered unconditionally (Redis is already
    // required infra for the `planning` queue above); only actually
    // scheduled when `RABBITMQ_URL` is configured (see
    // `BullMqGatherTimeoutScheduler`/`ContextModule`).
    BullModule.registerQueue({ name: GATHER_TIMEOUT_QUEUE_NAME }),
  ],
  providers: [{ provide: PROMPT_QUEUE, useClass: BullMqPromptQueue }],
  exports: [PROMPT_QUEUE, BullModule],
})
export class QueueModule {}
