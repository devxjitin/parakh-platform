import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import {
  PRICING,
  formatReceiptNo,
  joinFeeLines,
  platformFeeLines,
  reverseLines,
  type AdminPaymentRow,
  type PublishOrderDto,
  type PublishOrderInput,
  type PublishResultDto,
  type VerifyLinkInput,
  type VerifyPaymentInput,
} from '@parakh/shared';
import { ENV, Env } from '../config/env';
import { canRetake, computeJoinState, examJoinFee, normalizeCode } from '../enrollments/join-state';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { CertificatesService } from '../certificates/certificates.service';
import { LedgerService } from '../ledger/ledger.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { seatToken } from '../seats/capacity';
import {
  FakePaymentProvider,
  GatewayRefundError,
  PAYMENT_PROVIDER,
  PaymentProvider,
} from './provider';

// No 0/O/1/I/L so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateExamCode(): string {
  let tail = '';
  for (let i = 0; i < 6; i++) tail += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `NVX-${tail}`;
}

const UUID = /^[0-9a-f-]{36}$/i;

const STARTED_NO_REFUND =
  'This student has already started the exam, so the seat cannot be cancelled';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly certificates: CertificatesService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {
    if (provider.name === 'fake') {
      this.logger.warn(
        'PAYMENT_PROVIDER=fake: payments are simulated. Never use this in production.',
      );
    }
  }

  // ----------------------------------------------------------- create order

  /** Starts (or resumes) the creation-fee payment that publishes a draft exam. */
  async createPublishOrder(
    user: AuthUser,
    examId: string,
    input: PublishOrderInput = {},
  ): Promise<PublishOrderDto> {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({
          where: { id: examId, examinerId: user.id },
          include: { _count: { select: { questions: true } } },
        })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== 'DRAFT') throw new ConflictException('This exam is already published');

    this.assertPublishable(exam);

    const fees = await this.settings.get();
    // Trainer-pays mode: each listed email is one seat, bought together with the publish fee.
    // No email, no seat, so the list is de-duplicated and fixed for good once published.
    const emails = [
      ...new Set((input.studentEmails ?? []).map((e) => e.trim().toLowerCase())),
    ].sort();
    const ownEmail = (await this.prisma.user.findUnique({ where: { id: user.id } }))?.email;
    if (ownEmail && emails.includes(ownEmail)) {
      throw new BadRequestException('Remove your own email from the student list');
    }
    const joinFee = examJoinFee(exam, fees.examJoinPaise);
    const totalPaise = fees.examCreationPaise + emails.length * joinFee;
    // An unpaid order made at an old price or for another seat count is not reused.
    const existing = await this.prisma.payment.findFirst({
      where: {
        examId,
        purpose: 'EXAM_CREATION',
        status: 'CREATED',
        provider: this.provider.name,
        amountPaise: totalPaise,
        quantity: Math.max(emails.length, 1),
        sponsoredEmails: { equals: emails },
      },
      orderBy: { createdAt: 'desc' },
    });
    const description = (
      emails.length
        ? `Publish exam and ${emails.length} student seat${emails.length === 1 ? '' : 's'}: ${exam.title}`
        : `Publish exam: ${exam.title}`
    ).slice(0, 250);
    const opened = await this.openGatewayPayment(user, existing?.providerOrderId ?? null, {
      amountPaise: totalPaise,
      receipt: `exam_${exam.id.slice(0, 8)}_${Date.now().toString(36)}`,
      description,
    });
    const orderId = opened.orderId;
    if (opened.isNew) {
      await this.prisma.payment.create({
        data: {
          userId: user.id,
          examId,
          purpose: 'EXAM_CREATION',
          amountPaise: totalPaise,
          quantity: Math.max(emails.length, 1),
          sponsoredEmails: emails,
          currency: PRICING.CURRENCY,
          provider: this.provider.name,
          providerOrderId: orderId,
        },
      });
      await this.audit.log({
        actorId: user.id,
        action: 'payment.order',
        entity: 'Exam',
        entityId: examId,
      });
    }
    return {
      provider: this.provider.name,
      orderId,
      amountPaise: totalPaise,
      currency: PRICING.CURRENCY,
      keyId: this.provider.publicKeyId,
      description,
      ...(opened.paymentUrl ? { paymentUrl: opened.paymentUrl } : {}),
    };
  }

  /** Throws a 400 listing everything that still blocks publishing this draft. */
  private assertPublishable(exam: {
    startsAt: Date | null;
    endsAt: Date | null;
    durationMinutes: number;
    alwaysOpen?: boolean;
    catalogSummary?: string | null;
    catalogTopics?: string[];
    catalogCategory?: string;
    _count: { questions: number };
  }): void {
    const problems: string[] = [];
    if (exam._count.questions < 1) problems.push('Add at least one question.');
    if (exam.alwaysOpen) {
      // No window to check: students start any time after paying. It is listed publicly, so the
      // list card needs its summary and topics.
      if (!exam.catalogSummary?.trim() || !exam.catalogTopics?.length) {
        problems.push('Add the summary and topics for the exam list (Basics step).');
      }
      if (!exam.catalogCategory?.trim()) {
        problems.push('Choose the category this exam belongs to (Basics step).');
      }
    } else if (!exam.startsAt || !exam.endsAt) {
      problems.push('Set when the exam opens and closes (Settings tab).');
    } else {
      // The start is checked now, at publish time: a draft can sit for a while and the time chosen
      // earlier may have passed in the meantime.
      if (exam.startsAt <= new Date()) {
        problems.push(
          'The start time has already passed. Set a start time in the future (Settings tab).',
        );
      }
      if (exam.endsAt <= new Date()) problems.push('The closing time must be in the future.');
      const windowMinutes = (exam.endsAt.getTime() - exam.startsAt.getTime()) / 60000;
      if (windowMinutes < exam.durationMinutes) {
        problems.push('The open window is shorter than the exam duration.');
      }
    }
    if (problems.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: `Fix this before publishing: ${problems.join(' ')}`,
        problems,
      });
    }
  }

  /**
   * NandiVex publishes its own exam: no creation fee, no payment. Same checks and the same share
   * code as a paid publish.
   */
  async publishNandivexExam(user: AuthUser, examId: string) {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({
          where: { id: examId, examinerId: user.id, nandivexHosted: true },
          include: { _count: { select: { questions: true } } },
        })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    if (exam.status !== 'DRAFT') throw new ConflictException('This exam is already published');
    this.assertPublishable(exam);

    let code = generateExamCode();
    for (let i = 0; i < 5 && (await this.prisma.exam.findUnique({ where: { code } })); i++) {
      code = generateExamCode();
    }
    const claimed = await this.prisma.exam.updateMany({
      where: { id: exam.id, status: 'DRAFT' },
      data: { status: 'PUBLISHED', code, publishedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException('This exam is already published');
    await this.audit.log({
      actorId: user.id,
      action: 'exam.publish.nandivex',
      entity: 'Exam',
      entityId: exam.id,
    });
    return { id: exam.id, status: 'PUBLISHED' as const, code };
  }

  /**
   * Reuses the unpaid gateway payment when it still fits the current payment flow, or opens a new
   * one: a Checkout order, or a hosted Payment Link page when PAYMENT_FLOW=link.
   */
  private async openGatewayPayment(
    user: AuthUser,
    existingId: string | null,
    input: { amountPaise: number; receipt: string; description: string },
  ): Promise<{ orderId: string; paymentUrl?: string; isNew: boolean }> {
    const useLink = this.env.PAYMENT_FLOW === 'link';
    if (existingId && existingId.startsWith('plink_') === useLink) {
      if (!useLink) return { orderId: existingId, isNew: false };
      // An expired or cancelled link cannot be paid any more: make a fresh one.
      const link = await this.provider.getPaymentLink(existingId);
      if (link?.status === 'created') {
        return { orderId: existingId, paymentUrl: link.shortUrl, isNew: false };
      }
    }
    if (!useLink) {
      const order = await this.provider.createOrder({
        amountPaise: input.amountPaise,
        currency: PRICING.CURRENCY,
        receipt: input.receipt,
      });
      return { orderId: order.orderId, isNew: true };
    }
    const payer = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true, email: true },
    });
    const webBase = this.env.WEB_ORIGIN.split(',')[0].trim().replace(/\/+$/, '');
    const link = await this.provider.createPaymentLink({
      amountPaise: input.amountPaise,
      currency: PRICING.CURRENCY,
      referenceId: input.receipt,
      description: input.description,
      customer: { name: payer?.name ?? user.email, email: payer?.email ?? user.email },
      callbackUrl: `${webBase}/payment-return/`,
    });
    return { orderId: link.linkId, paymentUrl: link.shortUrl, isNew: true };
  }

  // --------------------------------------------------------------- verify

  /**
   * Called by the browser when Razorpay sends the payer back from a Payment Link page. The
   * signature proves the link was paid; the result also says where the app should go next.
   */
  async verifyLink(user: AuthUser, input: VerifyLinkInput): Promise<PublishResultDto> {
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: input.linkId },
    });
    if (!payment || payment.userId !== user.id) throw new NotFoundException('Payment not found');
    if (input.status !== 'paid' || !this.provider.verifyLinkSignature(input)) {
      await this.audit.log({
        actorId: user.id,
        action: 'payment.verify.failed',
        entity: 'Payment',
        entityId: payment.id,
      });
      throw new BadRequestException('Payment verification failed');
    }
    if (payment.status === 'REFUNDED') throw new ConflictException('This payment was refunded');
    const done = await this.capture(input.linkId, input.paymentId, undefined, 'link');
    const result = await this.resultFor(done);
    const exam = done?.examId
      ? await this.prisma.exam.findUnique({ where: { id: done.examId }, select: { code: true } })
      : null;
    result.next =
      done?.purpose === 'EXAM_JOIN' && exam?.code
        ? `/join/?code=${encodeURIComponent(exam.code)}`
        : `/exams/edit/?id=${encodeURIComponent(result.exam.id)}`;
    return result;
  }

  /** Called by the browser after Checkout. The signature proves the gateway captured the payment. */
  async verify(user: AuthUser, input: VerifyPaymentInput): Promise<PublishResultDto> {
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: input.orderId },
    });
    if (!payment || payment.userId !== user.id) throw new NotFoundException('Payment not found');
    if (!this.provider.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) {
      await this.audit.log({
        actorId: user.id,
        action: 'payment.verify.failed',
        entity: 'Payment',
        entityId: payment.id,
      });
      throw new BadRequestException('Payment verification failed');
    }
    if (payment.status === 'REFUNDED') throw new ConflictException('This payment was refunded');
    const done = await this.capture(input.orderId, input.paymentId, undefined, 'checkout');
    return this.resultFor(done);
  }

  /** What the browser gets back once a payment is confirmed: the exam, the seat and the receipt. */
  private async resultFor(
    done: Awaited<ReturnType<PaymentsService['capture']>>,
  ): Promise<PublishResultDto> {
    if (!done || done.status !== 'CAPTURED') {
      throw new BadRequestException('Payment could not be confirmed');
    }
    if (done.purpose === 'EXAM_JOIN') {
      const enrollment = await this.prisma.enrollment.findUnique({ where: { paymentId: done.id } });
      if (!enrollment || !done.examId) {
        throw new ConflictException(
          'Your payment was received but a seat could not be reserved. It will be refunded.',
        );
      }
      return {
        exam: { id: done.examId, status: 'PUBLISHED', code: null },
        enrollmentId: enrollment.id,
        receiptNo: formatReceiptNo(done.receiptNo),
      };
    }
    const exam = done.examId
      ? await this.prisma.exam.findUnique({
          where: { id: done.examId },
          select: { id: true, status: true, code: true },
        })
      : null;
    if (!exam) {
      throw new ConflictException('The exam for this payment no longer exists. Contact support.');
    }
    return { exam, receiptNo: formatReceiptNo(done.receiptNo) };
  }

  // -------------------------------------------------------------- webhook

  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    eventIdHeader: string | undefined,
    body: unknown,
  ): Promise<{ received: true; duplicate?: true }> {
    if (!rawBody || !this.provider.verifyWebhookSignature(rawBody, signature)) {
      await this.audit.log({ action: 'payment.webhook.badsignature' });
      throw new BadRequestException('Invalid signature');
    }
    const info = this.provider.parseWebhook(body, eventIdHeader);
    if (!info.eventId) throw new BadRequestException('Missing event id');

    const seen = await this.prisma.webhookEvent.findUnique({ where: { eventId: info.eventId } });
    if (seen) return { received: true, duplicate: true };

    if (info.type === 'captured' && info.orderId && info.paymentId) {
      await this.capture(info.orderId, info.paymentId, info.amountPaise, 'webhook');
    } else if (info.type === 'failed' && info.orderId) {
      // Only an unpaid order can fail; a captured payment is never downgraded.
      await this.prisma.payment.updateMany({
        where: { providerOrderId: info.orderId, status: 'CREATED' },
        data: { status: 'FAILED', failureReason: info.reason?.slice(0, 300) ?? null },
      });
    }

    // Recorded after processing so a crash mid-way lets the gateway's retry run again.
    try {
      await this.prisma.webhookEvent.create({
        data: { provider: this.provider.name, eventId: info.eventId, type: info.type },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    return { received: true };
  }

  // ---------------------------------------------------------------- fake

  /** Simulates a successful gateway checkout. Only exists for the fake provider. */
  async fakeComplete(user: AuthUser, orderId: string) {
    if (this.provider.name !== 'fake') throw new NotFoundException();
    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
    if (!payment || payment.userId !== user.id) throw new NotFoundException('Payment not found');
    const paymentId =
      payment.providerPaymentId ?? `fake_pay_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    return { orderId, paymentId, signature: FakePaymentProvider.sign(orderId, paymentId) };
  }

  // -------------------------------------------------------------- capture

  /**
   * Marks a payment captured and publishes the exam, exactly once. Safe to call repeatedly
   * and from both the browser and the webhook: only the call that flips the status acts.
   */
  private async capture(
    orderId: string,
    paymentId: string,
    amountPaise: number | undefined,
    via: string,
  ) {
    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: orderId } });
    if (!payment) return null;

    if (amountPaise !== undefined && amountPaise !== payment.amountPaise) {
      await this.audit.log({
        action: 'payment.amount.mismatch',
        entity: 'Payment',
        entityId: payment.id,
        meta: { expected: payment.amountPaise, received: amountPaise, via },
      });
      return payment;
    }

    const published = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ['CREATED', 'FAILED'] } },
        data: {
          status: 'CAPTURED',
          providerPaymentId: paymentId,
          capturedAt: new Date(),
          failureReason: null,
        },
      });
      if (claimed.count === 0) return null;

      // The money is in; the ledger records who it belongs to, in the same transaction.
      if (payment.purpose === 'EXAM_JOIN') {
        const result = await this.enroll(tx, payment);
        const lines =
          result.enrollment && result.exam?.nandivexHosted
            ? // NandiVex runs this exam itself: no trainer, so the whole fee is NandiVex's.
              platformFeeLines(payment.amountPaise, result.exam.id)
            : result.enrollment && result.exam
              ? joinFeeLines(
                  payment.amountPaise,
                  result.exam.examinerId,
                  result.exam.id,
                  payment.examinerSharePercent ?? (await this.settings.get()).examinerSharePercent,
                )
              : platformFeeLines(payment.amountPaise, payment.examId, 'NO_SEAT_REFUND_DUE');
        await this.ledger.post(tx, lines, { type: 'CREDIT', paymentId: payment.id });
        return result;
      }
      await this.ledger.post(tx, platformFeeLines(payment.amountPaise, payment.examId), {
        type: 'CREDIT',
        paymentId: payment.id,
      });
      if (!payment.examId) return { exam: null };
      const exam = await tx.exam.findUnique({ where: { id: payment.examId } });
      if (!exam) return { exam: null };
      // Another creation payment already published this exam: this one bought nothing.
      if (exam.status !== 'DRAFT') return { exam, skipped: 'DUPLICATE_PUBLISH' as const };
      // A payment that lands after the window closed must not publish an exam nobody can join.
      if (!exam.alwaysOpen && (!exam.endsAt || exam.endsAt <= new Date())) {
        return { exam, skipped: 'WINDOW_PASSED' as const };
      }
      const sponsored = payment.sponsoredEmails;
      if (sponsored.length > 0 && sponsored.length !== payment.quantity) {
        throw new Error(`Payment ${payment.id} seat list does not match the quantity paid for`);
      }

      let code = generateExamCode();
      for (let i = 0; i < 5 && (await tx.exam.findUnique({ where: { code } })); i++) {
        code = generateExamCode();
      }
      const updated = await tx.exam.update({
        where: { id: exam.id },
        data: { status: 'PUBLISHED', code, publishedAt: new Date(), sponsoredEmails: sponsored },
      });
      if (sponsored.length > 0) {
        const pack = await tx.seatPack.create({
          data: {
            examId: exam.id,
            sponsorId: payment.userId,
            paymentId: payment.id,
            seats: sponsored.length,
          },
        });
        await tx.seat.createMany({
          data: sponsored.map((email) => ({
            packId: pack.id,
            token: seatToken(),
            email,
          })),
        });
      }
      return { exam: updated };
    });

    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (published) {
      await this.audit.log({
        actorId: payment.userId,
        action: 'payment.captured',
        entity: 'Payment',
        entityId: payment.id,
        meta: { via, examId: payment.examId },
      });
      if (payment.purpose === 'EXAM_JOIN') {
        await this.afterEnroll(payment.id, payment.userId, published, fresh);
      } else if (!published.exam) {
        // Paid, but the exam was deleted meanwhile: flag for a manual refund.
        await this.flagOrphan(payment.id);
      } else if ('skipped' in published && published.skipped) {
        // Paid, but nothing was published (duplicate payment, or the window closed meanwhile).
        await this.flagOrphan(payment.id, published.skipped);
        if (published.skipped === 'WINDOW_PASSED') {
          const trainer = await this.prisma.user.findUnique({ where: { id: payment.userId } });
          if (trainer && published.exam) {
            await this.mail.sendWindowPassed(trainer.email, trainer.name, {
              examTitle: published.exam.title,
            });
          }
        }
      } else if (published.exam.code) {
        const user = await this.prisma.user.findUnique({ where: { id: payment.userId } });
        if (user && published.exam.sponsoredEmails.length > 0) {
          // The trainer listed these students: each gets the code, the marks and the join link.
          // The email never says who paid, and mentions certificates only when they are on.
          const marks = await this.prisma.question.aggregate({
            where: { examId: published.exam.id },
            _sum: { marks: true },
          });
          const samples = await this.certificates
            .inviteSamples(published.exam.id)
            .catch(() => null);
          for (const email of published.exam.sponsoredEmails) {
            await this.mail.sendExamInvite(email, {
              examTitle: published.exam.title,
              trainerName: user.name,
              code: published.exam.code,
              totalMarks: Number(marks._sum.marks ?? 0),
              durationMinutes: published.exam.durationMinutes,
              startsAt: published.exam.startsAt,
              endsAt: published.exam.endsAt,
              samples: samples ?? undefined,
            });
          }
        }
        if (user) {
          await this.mail.sendPublishReceipt(user.email, user.name, {
            examTitle: published.exam.title,
            code: published.exam.code,
            receiptNo: formatReceiptNo(fresh.receiptNo),
            amountPaise: fresh.amountPaise,
            paidAt: fresh.capturedAt ?? new Date(),
          });
        }
      }
    }
    return fresh;
  }

  /** The seat a student holds now for an exam (a retired seat from an earlier round is ignored). */
  private liveSeat(
    client: Pick<Prisma.TransactionClient, 'enrollment'>,
    examId: string,
    studentId: string,
  ) {
    return client.enrollment.findFirst({
      where: { examId, studentId, supersededAt: null },
      include: {
        exam: { select: { alwaysOpen: true } },
        attempt: { select: { status: true, resultEmailedAt: true } },
      },
    });
  }

  // ------------------------------------------------------------ join (students)

  /** Starts (or resumes) the join-fee payment for a published exam. */
  async createJoinOrder(user: AuthUser, rawCode: string): Promise<PublishOrderDto> {
    const exam = await this.prisma.exam.findUnique({
      where: { code: normalizeCode(rawCode) },
    });
    if (!exam || exam.status !== 'PUBLISHED') throw new NotFoundException('Exam code not found');
    const enrolled = await this.liveSeat(this.prisma, exam.id, user.id);
    const state = computeJoinState({
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
      alreadyEnrolled: Boolean(enrolled && !canRetake(enrolled)),
    });
    if (state === 'ALREADY_ENROLLED')
      throw new ConflictException('You have already joined this exam');
    if (state === 'ENDED') throw new ConflictException('This exam has ended');

    if (exam.sponsoredEmails.length > 0) {
      throw new ConflictException(
        'The trainer has paid for this exam. Join with the email the trainer invited, no payment needed.',
      );
    }
    const priceSettings = await this.settings.get();
    const feePaise = examJoinFee(exam, priceSettings.examJoinPaise);
    if (feePaise === 0) {
      throw new ConflictException('This exam is free. Join it without paying.');
    }
    const existing = await this.prisma.payment.findFirst({
      where: {
        examId: exam.id,
        userId: user.id,
        purpose: 'EXAM_JOIN',
        status: 'CREATED',
        provider: this.provider.name,
        amountPaise: feePaise,
      },
      orderBy: { createdAt: 'desc' },
    });
    const description = `Join exam: ${exam.title}`.slice(0, 250);
    const opened = await this.openGatewayPayment(user, existing?.providerOrderId ?? null, {
      amountPaise: feePaise,
      receipt: `join_${exam.id.slice(0, 8)}_${Date.now().toString(36)}`,
      description,
    });
    const orderId = opened.orderId;
    if (opened.isNew) {
      await this.prisma.payment.create({
        data: {
          userId: user.id,
          examId: exam.id,
          purpose: 'EXAM_JOIN',
          amountPaise: feePaise,
          examinerSharePercent: priceSettings.examinerSharePercent,
          currency: PRICING.CURRENCY,
          provider: this.provider.name,
          providerOrderId: orderId,
        },
      });
      await this.audit.log({
        actorId: user.id,
        action: 'payment.order.join',
        entity: 'Exam',
        entityId: exam.id,
      });
    }
    return {
      provider: this.provider.name,
      orderId,
      amountPaise: feePaise,
      currency: PRICING.CURRENCY,
      keyId: this.provider.publicKeyId,
      description,
      ...(opened.paymentUrl ? { paymentUrl: opened.paymentUrl } : {}),
    };
  }

  /** A free NandiVex exam: no payment, the seat is taken straight away. */
  async enrollFree(user: AuthUser, rawCode: string) {
    const exam = await this.prisma.exam.findUnique({ where: { code: normalizeCode(rawCode) } });
    if (!exam || exam.status !== 'PUBLISHED') throw new NotFoundException('Exam code not found');
    const sponsored = exam.sponsoredEmails.length > 0;
    if (!sponsored && examJoinFee(exam, (await this.settings.get()).examJoinPaise) !== 0) {
      throw new ConflictException('This exam has a fee. Pay to join it.');
    }
    const state = computeJoinState({
      startsAt: exam.startsAt,
      endsAt: exam.endsAt,
      alreadyEnrolled: false,
    });
    if (state === 'ENDED') throw new ConflictException('This exam has ended');
    const existing = await this.liveSeat(this.prisma, exam.id, user.id);
    if (existing && !canRetake(existing)) return { enrollmentId: existing.id };
    // Trainer-pays exam: only an invited email has a seat, and a seat is used once.
    const seat = sponsored
      ? await this.prisma.seat.findFirst({
          where: {
            pack: { examId: exam.id },
            email: { equals: user.email, mode: 'insensitive' },
            redeemedAt: null,
          },
        })
      : null;
    if (sponsored && !seat) {
      throw new ForbiddenException(
        'There is no seat for this email. This exam is only for students the trainer invited.',
      );
    }
    let enrollment;
    try {
      enrollment = await this.prisma.$transaction(async (tx) => {
        if (seat) {
          const claimed = await tx.seat.updateMany({
            where: { id: seat.id, redeemedAt: null },
            data: { redeemedById: user.id, redeemedAt: new Date() },
          });
          if (claimed.count === 0) throw new ConflictException('This seat has just been used');
        }
        // Taking the exam again: the finished seat stays as history, the new one goes live.
        if (existing) {
          await tx.enrollment.update({
            where: { id: existing.id },
            data: { supersededAt: new Date() },
          });
        }
        const created = await tx.enrollment.create({
          data: { examId: exam.id, studentId: user.id, seatId: seat?.id ?? null },
        });
        if (seat)
          await tx.seat.update({ where: { id: seat.id }, data: { enrollmentId: created.id } });
        return created;
      });
    } catch (err) {
      // Two clicks at once: the other request already took the seat.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.liveSeat(this.prisma, exam.id, user.id);
        if (again) return { enrollmentId: again.id };
      }
      throw err;
    }
    await this.audit.log({
      actorId: user.id,
      action: 'enrollment.free',
      entity: 'Exam',
      entityId: exam.id,
    });
    const student = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (student && exam.code) {
      await this.mail.sendJoinConfirmation(student.email, student.name, {
        examTitle: exam.title,
        code: exam.code,
        startsAt: exam.startsAt,
        endsAt: exam.endsAt,
      });
    }
    return { enrollmentId: enrollment.id };
  }

  // ------------------------------------------------------------------ refunds

  /**
   * Admin-initiated refund. The gateway sends the money back, the ledger reverses both shares
   * (so the trainer's accrued share goes down too) and the seat or enrollment is cancelled.
   */
  async refund(admin: AuthUser, paymentId: string, reason: string) {
    const payment = UUID.test(paymentId)
      ? await this.prisma.payment.findUnique({
          where: { id: paymentId },
          include: {
            user: { select: { name: true, email: true } },
            exam: { select: { title: true } },
            enrollment: { include: { attempt: { select: { id: true } } } },
            seatPack: { include: { items: true } },
          },
        })
      : null;
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'REFUNDED')
      throw new ConflictException('This payment is already refunded');
    if (payment.status === 'PENDING_REFUND')
      throw new ConflictException('This refund is already being processed');
    if (payment.status !== 'CAPTURED' || !payment.providerPaymentId) {
      throw new ConflictException('Only a captured payment can be refunded');
    }
    if (payment.purpose === 'EXAM_CREATION') {
      throw new ConflictException('Exam creation fees are not refunded here');
    }
    if (payment.enrollment?.attempt) {
      throw new ConflictException(STARTED_NO_REFUND);
    }
    if (payment.seatPack?.items.some((i) => i.redeemedAt)) {
      throw new ConflictException(
        'Some of these seats were already used, so the order cannot be refunded',
      );
    }

    // Claim first so two admins cannot refund the same payment twice. The payment stays
    // PENDING_REFUND until the gateway AND the ledger are both done; refundedAt doubles as the
    // time of the last attempt, which the refund sweeper uses to pick up stuck ones.
    // The claim and the "has the student started?" check run in one transaction: starting an
    // attempt locks this same payment row, so one of the two always sees the other.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const res = await tx.payment.updateMany({
        where: { id: payment.id, status: 'CAPTURED' },
        data: { status: 'PENDING_REFUND', refundedAt: new Date(), refundReason: reason },
      });
      if (res.count === 0) return 'ALREADY' as const;
      const started = payment.enrollment
        ? await tx.attempt.findUnique({ where: { enrollmentId: payment.enrollment.id } })
        : null;
      if (started) throw new ConflictException(STARTED_NO_REFUND);
      return 'CLAIMED' as const;
    });
    if (claimed === 'ALREADY') throw new ConflictException('This payment is already refunded');

    let refundId: string;
    try {
      refundId = (await this.provider.refund(payment.providerPaymentId, payment.amountPaise))
        .refundId;
    } catch (err) {
      const rejected = err instanceof GatewayRefundError && err.definite;
      // A rejected call can still mean the money already went back earlier; check before giving up.
      const existing = rejected ? await this.findRefundSafely(payment.providerPaymentId) : null;
      if (existing) {
        refundId = existing;
      } else if (rejected) {
        await this.prisma.payment.updateMany({
          where: { id: payment.id, status: 'PENDING_REFUND' },
          data: { status: 'CAPTURED', refundedAt: null, refundReason: null },
        });
        this.logger.error('Refund rejected by the gateway', err as Error);
        throw new ServiceUnavailableException(
          'The payment gateway could not process the refund. Try again.',
        );
      } else {
        // Unknown outcome: leave it PENDING_REFUND. The sweeper looks the refund up and finishes it.
        this.logger.error('Refund outcome unknown; the sweeper will settle it', err as Error);
        throw new ServiceUnavailableException(
          'The refund is being confirmed with the payment gateway and will complete automatically. Check again in a few minutes.',
        );
      }
    }

    await this.finishRefund(payment.id, refundId, admin.id);
    return { refunded: true as const, refundId };
  }

  /** The refund the gateway already holds for a payment; null if none or the lookup failed. */
  async findRefundSafely(providerPaymentId: string): Promise<string | null> {
    try {
      return (await this.provider.findRefund(providerPaymentId))?.refundId ?? null;
    } catch (err) {
      this.logger.error('Refund lookup failed at the gateway', err as Error);
      return null;
    }
  }

  /**
   * Second half of a refund, after the gateway has the money back: reverse both ledger shares,
   * cancel the seat or enrollment and mark the payment REFUNDED, all in one transaction. Only a
   * PENDING_REFUND payment is touched, so running it twice is harmless. Returns false if some
   * other call already finished it.
   */
  async finishRefund(paymentId: string, refundId: string, actorId?: string): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        user: { select: { name: true, email: true } },
        exam: { select: { title: true } },
        enrollment: { select: { id: true } },
        seatPack: { select: { id: true } },
      },
    });
    if (!payment || payment.status !== 'PENDING_REFUND') return false;
    const reason = payment.refundReason ?? 'Refunded';

    const finished = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING_REFUND' },
        data: { status: 'REFUNDED', refundedAt: new Date(), refundId },
      });
      if (claimed.count === 0) return false;
      const original = await tx.ledgerEntry.findMany({
        where: { paymentId: payment.id, type: 'CREDIT' },
      });
      await this.ledger.post(
        tx,
        reverseLines(
          original.map((e) => ({
            account: e.account,
            amountPaise: e.amountPaise,
            examId: e.examId,
            note: e.note ?? undefined,
          })),
        ),
        { type: 'REFUND', paymentId: payment.id },
      );
      if (payment.enrollment) {
        // A seat that somehow has an attempt is retired, never deleted (the attempt keeps it alive).
        const hasAttempt = await tx.attempt.findUnique({
          where: { enrollmentId: payment.enrollment.id },
          select: { id: true },
        });
        if (hasAttempt) {
          await tx.enrollment.update({
            where: { id: payment.enrollment.id },
            data: { supersededAt: new Date() },
          });
        } else {
          await tx.enrollment.delete({ where: { id: payment.enrollment.id } });
        }
      }
      if (payment.seatPack) await tx.seatPack.delete({ where: { id: payment.seatPack.id } });
      return true;
    });
    if (!finished) return false;

    await this.audit.log({
      actorId: actorId ?? null,
      action: 'payment.refund',
      entity: 'Payment',
      entityId: payment.id,
      meta: { amountPaise: payment.amountPaise, reason, refundId },
    });
    await this.mail.sendRefundNotice(payment.user.email, payment.user.name, {
      amountPaise: payment.amountPaise,
      what: `your seat in "${payment.exam?.title ?? 'an exam'}"`,
      reason,
    });
    return true;
  }

  /** Recent payments for the admin to find and refund. */
  /** Money taken but nothing delivered: mark it so the admin console lists it for a refund. */
  private async flagOrphan(paymentId: string, reason?: string) {
    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { needsRefund: true },
    });
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { email: true },
    });
    for (const a of admins) {
      await this.mail.sendRefundNeeded(a.email, {
        receiptNo: formatReceiptNo(payment.receiptNo),
        amountPaise: payment.amountPaise,
        reason: reason ?? 'no seat or exam',
      });
    }
    await this.audit.log({
      action: 'payment.orphan',
      entity: 'Payment',
      entityId: paymentId,
      meta: reason ? { reason } : undefined,
    });
  }

  async listForAdmin(filter: {
    status?: string;
    purpose?: string;
    q?: string;
  }): Promise<AdminPaymentRow[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        status: (['CREATED', 'CAPTURED', 'FAILED', 'PENDING_REFUND', 'REFUNDED'] as const).find(
          (s) => s === filter.status,
        ),
        purpose: (['EXAM_CREATION', 'EXAM_JOIN'] as const).find((p) => p === filter.purpose),
        ...(filter.q
          ? {
              OR: [
                { user: { email: { contains: filter.q, mode: 'insensitive' as const } } },
                { user: { name: { contains: filter.q, mode: 'insensitive' as const } } },
                { exam: { title: { contains: filter.q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { name: true, email: true } }, exam: { select: { title: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      receiptNo: formatReceiptNo(p.receiptNo),
      purpose: p.purpose,
      status: p.status,
      amountPaise: p.amountPaise,
      userName: p.user.name,
      userEmail: p.user.email,
      examTitle: p.exam?.title ?? null,
      quantity: p.quantity,
      capturedAt: p.capturedAt?.toISOString() ?? null,
      refundedAt: p.refundedAt?.toISOString() ?? null,
      refundReason: p.refundReason,
      needsRefund: p.needsRefund,
    }));
  }

  /** Runs inside the capture transaction: takes a seat, or explains why it could not. */
  private async enroll(
    tx: Prisma.TransactionClient,
    payment: { id: string; userId: string; examId: string | null },
  ) {
    const exam = payment.examId
      ? await tx.exam.findUnique({ where: { id: payment.examId } })
      : null;
    if (!exam || exam.status !== 'PUBLISHED' || (exam.endsAt && exam.endsAt <= new Date())) {
      return { exam, enrollment: null, reason: 'EXAM_UNAVAILABLE' };
    }
    const already = await this.liveSeat(tx, exam.id, payment.userId);
    if (already && !canRetake(already)) return { exam, enrollment: null, reason: 'DUPLICATE' };
    // Taking the exam again: the finished seat stays as history, the new one goes live.
    if (already) {
      await tx.enrollment.update({ where: { id: already.id }, data: { supersededAt: new Date() } });
    }
    const enrollment = await tx.enrollment.create({
      data: { examId: exam.id, studentId: payment.userId, paymentId: payment.id },
    });
    return { exam, enrollment, reason: null };
  }

  private async afterEnroll(
    paymentId: string,
    userId: string,
    result: {
      exam: {
        title: string;
        code: string | null;
        startsAt: Date | null;
        endsAt: Date | null;
      } | null;
      enrollment?: unknown;
      reason?: string | null;
    },
    payment: { receiptNo: number; amountPaise: number; capturedAt: Date | null },
  ) {
    if (!result.enrollment || !result.exam) {
      // Money taken but no seat: flag for a manual refund.
      await this.flagOrphan(paymentId, result.reason ?? 'UNKNOWN');
      return;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await this.mail.sendJoinReceipt(user.email, user.name, {
        examTitle: result.exam.title,
        code: result.exam.code ?? '',
        startsAt: result.exam.startsAt,
        endsAt: result.exam.endsAt,
        receiptNo: formatReceiptNo(payment.receiptNo),
        amountPaise: payment.amountPaise,
        paidAt: payment.capturedAt ?? new Date(),
      });
    }
  }
}
