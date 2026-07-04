import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PROMPT_QUEUE } from '../../../domain/context/prompt-queue';
import { BullMqPromptQueue } from './bullmq-prompt-queue';

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
  ],
  providers: [{ provide: PROMPT_QUEUE, useClass: BullMqPromptQueue }],
  exports: [PROMPT_QUEUE, BullModule],
})
export class QueueModule {}
