import { Global, Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { MAIL_TRANSPORT, MailService, createTransport } from './mail.service';

@Global()
@Module({
  providers: [
    { provide: MAIL_TRANSPORT, inject: [ENV], useFactory: (env: Env) => createTransport(env) },
    MailService,
  ],
  exports: [MailService, MAIL_TRANSPORT],
})
export class MailModule {}
