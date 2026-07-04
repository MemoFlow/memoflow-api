import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';

async function bootstrap() {
  // `rawBody: true` preserves the raw request buffer alongside the parsed
  // body (on `req.rawBody`), purely additive — it doesn't change how any
  // other route or the global ValidationPipe sees `req.body`. Needed so
  // `POST /connectors/webhook` can verify Composio's HMAC signature against
  // the exact bytes Composio signed, not a re-serialized JSON.parse/stringify
  // round trip.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Lets in-process consumers (the BullMQ worker, Redis/Mongo/Postgres
  // connections) drain cleanly on SIGTERM instead of being killed mid-job.
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MemoFlow API')
    .setDescription('REST API for MemoFlow — users, documents, AI, connectors')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const config = app.get(ConfigService);
  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
