import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { text } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { requestLogger } from './common/request-log';
import { ENV, Env } from './config/env';

/** HTTP setup shared by the real server and the end-to-end tests. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  // First, so every response (even a rejected one) carries a request id.
  app.use(requestLogger({ enabled: env.NODE_ENV === 'production' }));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost).httpAdapter));
  app.use(helmet());
  app.use(cookieParser());
  // AWS SNS posts its JSON as text/plain. Keep the raw bytes for the notice handler.
  app.use(
    text({
      type: 'text/plain',
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  app.enableCors({
    origin: [env.WEB_ORIGIN, env.WEBSITE_ORIGIN ?? '']
      .flatMap((list) => list.split(','))
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });
  app.enableShutdownHooks();
}
