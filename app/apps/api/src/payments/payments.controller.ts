import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  fakeCompleteSchema,
  publishOrderSchema,
  refundSchema,
  verifyLinkSchema,
  verifyPaymentSchema,
  type FakeCompleteInput,
  type PublishOrderInput,
  type RefundInput,
  type VerifyLinkInput,
  type VerifyPaymentInput,
} from '@parakh/shared';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Step 1 of publishing: create (or resume) the creation-fee order. */
  @Roles('EXAMINER')
  @Post('exams/:id/publish-order')
  @HttpCode(200)
  createOrder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(publishOrderSchema)) body: PublishOrderInput,
  ) {
    return this.payments.createPublishOrder(user, id, body);
  }

  /** Admin only: publish a NandiVex-run exam. No creation fee, no payment. */
  @Roles('ADMIN')
  @Post('exams/:id/publish')
  @HttpCode(200)
  publishNandivex(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.publishNandivexExam(user, id);
  }

  /** Admin: find payments. */
  @Roles('ADMIN')
  @Get('admin/finance/payments')
  adminList(
    @Query('status') status?: string,
    @Query('purpose') purpose?: string,
    @Query('q') q?: string,
  ) {
    return this.payments.listForAdmin({ status, purpose, q: q?.trim() || undefined });
  }

  /** Admin: refund a payment. Reverses the trainer's share and cancels the seat. */
  @Roles('ADMIN')
  @Post('admin/finance/payments/:id/refund')
  @HttpCode(200)
  adminRefund(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(refundSchema)) body: RefundInput,
  ) {
    return this.payments.refund(admin, id, body.reason);
  }

  /** Student: start (or resume) the join-fee order for an exam code. */
  @Roles('STUDENT')
  @Post('join/:code/order')
  @HttpCode(200)
  createJoinOrder(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.payments.createJoinOrder(user, code);
  }

  /** Student: take a seat in a free exam (no payment step). */
  @Roles('STUDENT')
  @Post('join/:code/enroll')
  @HttpCode(200)
  enrollFree(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.payments.enrollFree(user, code);
  }

  /** Step 2: the browser reports the gateway's result; the signature is checked server-side. */
  @Roles('EXAMINER', 'STUDENT')
  @Post('payments/verify')
  @HttpCode(200)
  verify(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(verifyPaymentSchema)) body: VerifyPaymentInput,
  ) {
    return this.payments.verify(user, body);
  }

  /** After a Payment Link: Razorpay's callback parameters; the signature is checked server-side. */
  @Roles('EXAMINER', 'STUDENT')
  @Post('payments/verify-link')
  @HttpCode(200)
  verifyLink(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(verifyLinkSchema)) body: VerifyLinkInput,
  ) {
    return this.payments.verifyLink(user, body);
  }

  /** Fake provider only: stands in for the gateway's checkout. 404 when real payments are on. */
  @Roles('EXAMINER', 'STUDENT')
  @Post('payments/fake/complete')
  @HttpCode(200)
  fakeComplete(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(fakeCompleteSchema)) body: FakeCompleteInput,
  ) {
    return this.payments.fakeComplete(user, body.orderId);
  }

  /** Called by the gateway, not by a user: authenticated by its signature instead of a token. */
  @Public()
  @SkipThrottle()
  @Post('payments/webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
    @Body() body: unknown,
  ) {
    return this.payments.handleWebhook(req.rawBody, signature, eventId, body);
  }
}
