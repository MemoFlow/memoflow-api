// Must be the very first import: @sentry/nestjs's auto-instrumentation
// needs Sentry.init() to run before AppModule (and the http/pg/mongo/redis
// libs it pulls in) load.
import './instrument';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Behind Render's reverse proxy: trust the first hop so `req.ip` reflects the
  // real client IP (from X-Forwarded-For) rather than the proxy's address. The
  // rate limiter (ThrottlerGuard) keys on `req.ip`, so without this every
  // client would collapse into one bucket and share a single limit.
  app.set('trust proxy', 1);

  // Sets baseline security headers (X-Content-Type-Options: nosniff,
  // Strict-Transport-Security, X-Frame-Options, etc.). The Content-Security-
  // Policy is widened from helmet's default so the Swagger UI served at
  // `/docs` still renders: swagger-ui ships an inline bootstrap script +
  // inline styles and loads its validator badge from validator.swagger.io,
  // all of which helmet's default `default-src 'self'` would block.
  // Everything else stays at helmet's secure defaults.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          scriptSrc: [`'self'`, `'unsafe-inline'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
        },
      },
    }),
  );

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

  const config = app.get(ConfigService);

  // Swagger UI + the underlying OpenAPI JSON are a discovery surface for the
  // API's shape (routes, DTOs, auth scheme) — production must not expose it.
  if (config.get<string>('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MemoFlow API')
      .setDescription(
        'REST API for MemoFlow — users, documents, AI, connectors',
      )
      .setVersion('0.0.1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  // Auth is a Bearer token in the Authorization header, not cookies, so this
  // never needs `credentials: true` — and must not set it, since browsers
  // reject `credentials: true` combined with an `origin: '*'` response
  // (which is CORS_ORIGIN's dev default). Mirrors WS_CORS_ORIGIN's pattern.
  app.enableCors({ origin: config.getOrThrow<string>('CORS_ORIGIN') });

  await app.listen(config.getOrThrow<number>('PORT'));
}
void bootstrap();
