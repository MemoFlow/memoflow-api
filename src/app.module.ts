import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from './ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit.module';
import { validate } from './config/env.validation';
import { ConnectorsModule } from './connectors.module';
import { ContextModule } from './context.module';
import { DocumentVersionsModule } from './document-versions.module';
import { DocumentsModule } from './documents.module';
import { GamificationModule } from './gamification.module';
import { HealthModule } from './shared/health/health.module';
import { AppThrottlerModule } from './shared/throttler/throttler.module';
import { TemplatesModule } from './templates.module';
import { UsersModule } from './users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ validate, isGlobal: true }),
    EventEmitterModule.forRoot(),
    AppThrottlerModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('POSTGRES_HOST'),
        port: config.getOrThrow<number>('POSTGRES_PORT'),
        username: config.getOrThrow<string>('POSTGRES_USER'),
        password: config.getOrThrow<string>('POSTGRES_PASSWORD'),
        database: config.getOrThrow<string>('POSTGRES_DB'),
        autoLoadEntities: true,
        // Schema changes go through generated migrations only. Never enable.
        synchronize: false,
        // rejectUnauthorized:false — dev/staging managed Postgres (e.g. Neon)
        // that don't provide a CA cert. Revisit if a verifiable CA becomes available.
        ssl: config.get<boolean>('POSTGRES_SSL')
          ? { rejectUnauthorized: false }
          : false,
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    HealthModule,
    UsersModule,
    AiModule,
    ContextModule,
    ConnectorsModule,
    DocumentsModule,
    DocumentVersionsModule,
    TemplatesModule,
    GamificationModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
