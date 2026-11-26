import { Controller, Get, Param } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { MyPaymentsService } from './my-payments.service';

/** Every trainer and student: their own payments and receipts. */
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
}
