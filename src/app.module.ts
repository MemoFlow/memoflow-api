import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validate } from './config/env.validation';
import { HealthModule } from './shared/health/health.module';
import { UsersModule } from './users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ validate, isGlobal: true }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
