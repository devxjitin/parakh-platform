import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  refundRequestSchema,
  rejectRefundRequestSchema,
  type RefundRequestInput,
  type RejectRefundRequestInput,
} from '@parakh/shared';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod.pipe';
import { MyPaymentsService } from './my-payments.service';

/** Every trainer and student: their own payments, receipts and refund requests. */
@Roles('EXAMINER', 'STUDENT')
@Controller('me/payments')
export class MyPaymentsController {
  constructor(private readonly mine: MyPaymentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.mine.list(user);
  }

  @Get(':id')
  receipt(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.mine.receipt(user, id);
  }

  @Post(':id/refund-request')
  @HttpCode(200)
  requestRefund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(refundRequestSchema)) body: RefundRequestInput,
  ) {
    return this.mine.requestRefund(user, id, body.reason);
  }
}

/** NandiVex staff: the queue of students asking for their exam fee back. */
@Roles('ADMIN')
@Controller('admin/finance/refund-requests')
export class AdminRefundRequestsController {
  constructor(private readonly mine: MyPaymentsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.mine.listRequests(status);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.mine.approve(admin, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectRefundRequestSchema)) body: RejectRefundRequestInput,
  ) {
    return this.mine.reject(admin, id, body.note);
  }
}
