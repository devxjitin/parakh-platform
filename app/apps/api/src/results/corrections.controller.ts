import { Body, Controller, HttpCode, Param, Put } from '@nestjs/common';
import { overrideMarksSchema, type OverrideMarksInput } from '@parakh/shared';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CorrectionsService } from './corrections.service';

/**
 * A published exam is never edited: its questions, answer key and wording stay as published.
 * The only change a trainer can make afterwards is a one-off mark for one student's answer.
 */
@Roles('EXAMINER', 'ADMIN')
@Controller('exams/:examId')
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}

  @Put('attempts/:attemptId/answers/:questionId/override')
  @HttpCode(200)
  override(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('attemptId') attemptId: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(overrideMarksSchema)) body: OverrideMarksInput,
  ) {
    return this.corrections.overrideMarks(user, examId, attemptId, questionId, body);
  }
}
