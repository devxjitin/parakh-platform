import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  practiceCheckSchema,
  practiceSubmitSchema,
  type PracticeCheckInput,
  type PracticeSubmitInput,
} from '@parakh/shared';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod.pipe';
import { sendPrivateImage } from '../storage/private-image';
import { PracticeService } from './practice.service';

@Roles('STUDENT')
@Controller('practice')
export class PracticeController {
  constructor(private readonly practice: PracticeService) {}

  /** Practice sets this student can open. */
  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.practice.mine(user);
  }

  @Get(':examId')
  set(@CurrentUser() user: AuthUser, @Param('examId') examId: string) {
    return this.practice.set(user, examId);
  }

  @Get(':examId/questions/:questionId/image')
  async questionImage(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('questionId') questionId: string,
    @Res() res: Response,
  ) {
    sendPrivateImage(res, await this.practice.questionImage(user, examId, questionId));
  }

  @Post(':examId/questions/:questionId/check')
  @HttpCode(200)
  check(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(practiceCheckSchema)) body: PracticeCheckInput,
  ) {
    return this.practice.check(user, examId, questionId, body);
  }

  @Post(':examId/rounds')
  @HttpCode(200)
  submit(
    @CurrentUser() user: AuthUser,
    @Param('examId') examId: string,
    @Body(new ZodValidationPipe(practiceSubmitSchema)) body: PracticeSubmitInput,
  ) {
    return this.practice.submit(user, examId, body);
  }

  @Get(':examId/rounds')
  history(@CurrentUser() user: AuthUser, @Param('examId') examId: string) {
    return this.practice.history(user, examId);
  }
}
