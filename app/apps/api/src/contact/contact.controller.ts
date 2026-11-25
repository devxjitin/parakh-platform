import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { contactMessageSchema, type ContactMessageInput } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import { Public } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';

/** Public: the NandiVex company website's "Send us a message" form. */
@Controller('contact')
export class ContactController {
  constructor(
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  // Each message sends two emails, so one address may send only a few a minute.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  async send(@Body(new ZodValidationPipe(contactMessageSchema)) body: ContactMessageInput) {
    // A bot filled the hidden field: pretend it worked and send nothing.
    if (body.website?.trim()) return { sent: true };
    try {
      await this.mail.sendContactMessage(this.env.CONTACT_INBOX, body);
    } catch {
      return { sent: false };
    }
    await this.mail.sendContactReceipt(body.email, body.name);
    await this.audit.log({
      action: 'contact.message',
      entity: 'Contact',
      meta: { topic: body.topic ?? null },
    });
    return { sent: true };
  }
}
