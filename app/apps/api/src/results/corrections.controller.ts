import { Body, Controller, HttpCode, Param, Patch, Put } from '@nestjs/common';
import {
  answerKeySchema,
  correctQuestionSchema,
  dropQuestionSchema,
  overrideMarksSchema,
  type AnswerKeyInput,
  type CorrectQuestionInput,
  type DropQuestionInput,
  type OverrideMarksInput,
} from '@parakh/shared';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CorrectionsService } from './corrections.service';

/** Trainer-only fixes to a published exam, before results are published. */
@Roles('EXAMINER', 'ADMIN')
@Controller('exams/:examId')
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}

  @Patch('questions/:questionId/correction')
  correct(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(correctQuestionSchema)) body: CorrectQuestionInput,
  ) {
    return this.corrections.correctText(user, examId, questionId, body);
  }

  @Put('questions/:questionId/answer-key')
  @HttpCode(200)
  key(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(answerKeySchema)) body: AnswerKeyInput,
  ) {
    return this.corrections.setAnswerKey(user, examId, questionId, body);
  }

  @Put('questions/:questionId/dropped')
  @HttpCode(200)
  drop(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(dropQuestionSchema)) body: DropQuestionInput,
  ) {
    return this.corrections.setDropped(user, examId, questionId, body);
  }

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
