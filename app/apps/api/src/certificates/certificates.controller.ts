import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  approveCertificatesSchema,
  certificateTemplateSchema,
  rejectCertificatesSchema,
  type ApproveCertificatesInput,
  type CertKind,
  type CertStatus,
  type CertificateTemplate,
  type RejectCertificatesInput,
} from '@parakh/shared';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Inject } from '@nestjs/common';
import { CertificatesService } from './certificates.service';

const pdf = (res: Response, file: { filename: string; body: Buffer }) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.body);
};

const STATUSES: CertStatus[] = ['GENERATED', 'APPROVED', 'REJECTED', 'EMAILED'];

@Controller()
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  // ---- trainer

  @Roles('EXAMINER', 'ADMIN')
  @Get('exams/:examId/certificate')
  trainerView(@CurrentUser() user: AuthUser, @Param('examId') examId: string) {
    return this.certificates.trainerView(user, examId);
  }

  @Roles('EXAMINER', 'ADMIN')
  @Put('exams/:examId/certificate')
  save(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Body(new ZodValidationPipe(certificateTemplateSchema)) body: CertificateTemplate,
  ) {
    return this.certificates.saveTemplate(user, examId, body);
  }

  /** A sample PDF of the template as it is being edited. */
  @Roles('EXAMINER', 'ADMIN')
  @Post('exams/:examId/certificate/preview')
  @HttpCode(200)
  async preview(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Body(new ZodValidationPipe(certificateTemplateSchema)) body: CertificateTemplate,
    @Query('kind') kind: string | undefined,
    @Res() res: Response,
  ) {
    const k: CertKind = kind === 'PARTICIPATION' || kind === 'TRAINER' ? kind : 'ACHIEVEMENT';
    pdf(res, {
      filename: 'certificate-preview.pdf',
      body: await this.certificates.preview(user, examId, body, k),
    });
  }

  // ---- student

  // Students see their own certificates; trainers see the ones for the exams they ran.
  @Roles('STUDENT', 'EXAMINER')
  @Get('certificates/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.certificates.mine(user);
  }

  @Roles('STUDENT', 'EXAMINER')
  @Get('certificates/:id/pdf')
  async studentPdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    pdf(res, await this.certificates.studentPdf(user, id));
  }

  // ---- admin

  @Roles('ADMIN')
  @Get('admin/certificates')
  queue(@Query('status') status?: string, @Query('examId') examId?: string) {
    const s = STATUSES.find((x) => x === status);
    return this.certificates.queue(s ?? 'GENERATED', examId);
  }

  @Roles('ADMIN')
  @Get('admin/certificates/:id/pdf')
  async adminPdf(@Param('id') id: string, @Res() res: Response) {
    pdf(res, await this.certificates.adminPdf(id));
  }

  @Roles('ADMIN')
  @Post('admin/certificates/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() admin: AuthUser,
    @Body(new ZodValidationPipe(approveCertificatesSchema)) body: ApproveCertificatesInput,
  ) {
    return this.certificates.approve(admin, body);
  }

  @Roles('ADMIN')
  @Post('admin/certificates/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() admin: AuthUser,
    @Body(new ZodValidationPipe(rejectCertificatesSchema)) body: RejectCertificatesInput,
  ) {
    return this.certificates.reject(admin, body.ids, body.reason);
  }

  @Roles('ADMIN')
  @Post('admin/certificates/:id/regenerate')
  @HttpCode(200)
  regenerate(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.certificates.regenerate(admin, id);
  }

  @Roles('ADMIN')
  @Post('admin/certificates/:id/resend')
  @HttpCode(200)
  resend(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.certificates.resend(admin, id);
  }

  // ---- public

  /** Anyone can check a certificate. The answer has the holder, exam and date, never a score. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('verify/:serial')
  verify(@Param('serial') serial: string) {
    return this.certificates.verify(serial);
  }
}

/**
 * Receives mail delivery, bounce and complaint notices from AWS SNS. SNS cannot send a token, so
 * the URL carries a secret key instead (set in the subscription endpoint).
 */
@Controller('mail')
export class MailEventsController {
  constructor(
    private readonly certificates: CertificatesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('ses-events')
  @HttpCode(200)
  async sesEvents(
    @Query('key') key: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-amz-sns-message-type') type: string | undefined,
  ) {
    const expected = this.env.SES_EVENTS_KEY;
    const given = Buffer.from(key ?? '');
    if (
      !expected ||
      given.length !== expected.length ||
      !timingSafeEqual(given, Buffer.from(expected))
    ) {
      throw new NotFoundException();
    }
    let body: {
      MessageId?: string;
      SubscribeURL?: string;
      Message?: string;
    };
    try {
      body = JSON.parse((req.rawBody ?? Buffer.from('{}')).toString('utf8'));
    } catch {
      throw new BadRequestException('Not a valid notice');
    }

    if (type === 'SubscriptionConfirmation' && body.SubscribeURL) {
      // Only ever confirm with AWS itself.
      const url = new URL(body.SubscribeURL);
      const snsHost = /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
      if (url.protocol === 'https:' && snsHost) {
        await fetch(url).catch(() => undefined);
        return { confirmed: true };
      }
      throw new BadRequestException('Unexpected confirmation address');
    }
    if (type !== 'Notification' || !body.Message || !body.MessageId) return { ignored: true };

    let note: {
      eventType?: string;
      mail?: { messageId?: string };
      bounce?: { bounceType?: string; bouncedRecipients?: { emailAddress?: string }[] };
      complaint?: { complainedRecipients?: { emailAddress?: string }[] };
    };
    try {
      note = JSON.parse(body.Message);
    } catch {
      return { ignored: true };
    }
    const messageId = note.mail?.messageId;
    const kind =
      note.eventType === 'Bounce'
        ? 'BOUNCE'
        : note.eventType === 'Complaint'
          ? 'COMPLAINT'
          : note.eventType === 'Delivery'
            ? 'DELIVERY'
            : null;
    if (!messageId || !kind) return { ignored: true };
    await this.certificates.recordMailEvent({
      snsId: body.MessageId,
      kind,
      messageId,
      recipient:
        note.bounce?.bouncedRecipients?.[0]?.emailAddress ??
        note.complaint?.complainedRecipients?.[0]?.emailAddress,
      detail: note.bounce?.bounceType,
    });
    return { recorded: true };
  }
}
