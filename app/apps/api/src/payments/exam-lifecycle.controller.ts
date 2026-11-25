import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  cancelExamSchema,
  rescheduleExamSchema,
  type CancelExamInput,
  type RescheduleExamInput,
} from '@parakh/shared';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ExamLifecycleService } from './exam-lifecycle.service';

@Controller()
export class ExamLifecycleController {
  constructor(private readonly lifecycle: ExamLifecycleService) {}

  @Roles('EXAMINER', 'ADMIN')
  @Post('exams/:id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lifecycle.close(user, id);
  }

  /** Moves the opening and closing time of a published exam that nobody has started yet. */
  @Roles('EXAMINER')
  @Post('exams/:id/reschedule')
  @HttpCode(200)
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rescheduleExamSchema)) body: RescheduleExamInput,
  ) {
    return this.lifecycle.reschedule(user, id, body);
  }

  @Roles('EXAMINER', 'ADMIN')
  @Post('exams/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelExamSchema)) body: CancelExamInput,
  ) {
    return this.lifecycle.cancel(user, id, body);
  }

  /** Admin: stop someone else's exam (for example a fraudulent trainer) and refund the students. */
  @Roles('ADMIN')
  @Post('admin/exams/:id/suspend')
  @HttpCode(200)
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelExamSchema)) body: CancelExamInput,
  ) {
    return this.lifecycle.cancel(admin, id, body, true);
  }
}
