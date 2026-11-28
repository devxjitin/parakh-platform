import 'reflect-metadata';
import './common/sentry';
import { NestFactory } from '@nestjs/core';
import { BRAND } from '@parakh/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { ENV, Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Webhook signatures are computed over the exact raw bytes.
    rawBody: true,
  });
  // Behind Caddy: trust one proxy hop so req.ip is the real client address.
  app.set('trust proxy', 1);
  configureApp(app);
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
  console.log(`${BRAND.PRODUCT} API listening on :${env.PORT}`);
}

void bootstrap();
