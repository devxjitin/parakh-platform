import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  addTimeSchema,
  extraMinutesSchema,
  reopenAttemptSchema,
  type AddTimeInput,
  type ExtraMinutesInput,
  type ReopenAttemptInput,
} from '@parakh/shared';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AccommodationsService } from './accommodations.service';

/** Trainer-only adjustments for single students. */
@Roles('EXAMINER', 'ADMIN')
@Controller('exams/:examId')
export class AccommodationsController {
  constructor(private readonly accommodations: AccommodationsService) {}

  @Get('roster')
  roster(@CurrentUser() user: AuthUser, @Param('examId') examId: string) {
    return this.accommodations.roster(user, examId);
  }

  @Put('enrollments/:enrollmentId/extra-minutes')
  @HttpCode(200)
  extra(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('enrollmentId') enrollmentId: string,
    @Body(new ZodValidationPipe(extraMinutesSchema)) body: ExtraMinutesInput,
  ) {
    return this.accommodations.setExtraMinutes(user, examId, enrollmentId, body);
  }

  @Post('attempts/:attemptId/add-time')
  @HttpCode(200)
  addTime(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('attemptId') attemptId: string,
    @Body(new ZodValidationPipe(addTimeSchema)) body: AddTimeInput,
  ) {
    return this.accommodations.addTime(user, examId, attemptId, body);
  }

  @Post('attempts/:attemptId/reopen')
  @HttpCode(200)
  reopen(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('attemptId') attemptId: string,
    @Body(new ZodValidationPipe(reopenAttemptSchema)) body: ReopenAttemptInput,
  ) {
    return this.accommodations.reopen(user, examId, attemptId, body);
  }
}
