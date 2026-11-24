import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  proctorEventBatchSchema,
  proctorEventSchema,
  saveAnswerSchema,
  startAttemptSchema,
  type ProctorEventBatchInput,
  type ProctorEventInput,
  type SaveAnswerInput,
  type StartAttemptInput,
} from '@parakh/shared';
import { AuthUser, Client, ClientInfo, CurrentUser, Roles } from '../common/decorators';
import { UserRateLimitGuard } from '../common/user-rate-limit.guard';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ResultsService } from '../results/results.service';
import { sendPrivateImage } from '../storage/private-image';
import { AttemptsService } from './attempts.service';

/**
 * Autosave and proctor events are frequent and authenticated, and a whole classroom can share
 * one IP address, so the per-IP rate limit is switched off here and replaced by a per-user one.
 */
@Roles('STUDENT')
@SkipThrottle()
@UseGuards(UserRateLimitGuard)
@Controller('attempts')
export class AttemptsController {
  constructor(
    private readonly attempts: AttemptsService,
    private readonly results: ResultsService,
  ) {}

  @Post()
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthUser,
    @Client() client: ClientInfo,
    @Body(new ZodValidationPipe(startAttemptSchema)) body: StartAttemptInput,
  ) {
    return this.attempts.start(user, body.enrollmentId, client);
  }

  @Get(':id')
  view(@CurrentUser() user: AuthUser, @Client() client: ClientInfo, @Param('id') id: string) {
    return this.attempts.view(user, id, client);
  }

  @Get(':id/timing')
  @Header('Cache-Control', 'private, no-store')
  timing(@CurrentUser() user: AuthUser, @Client() client: ClientInfo, @Param('id') id: string) {
    return this.attempts.timing(user, id, client);
  }

  @Get(':id/questions/:questionId/image')
  async questionImage(
    @CurrentUser() user: AuthUser,
    @Client() client: ClientInfo,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Res() res: Response,
  ) {
    sendPrivateImage(res, await this.attempts.questionImage(user, id, questionId, client));
  }

  /** Only available once the trainer has published results. */
  @Get(':id/result')
  result(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.results.studentResult(user, id);
  }

  @Put(':id/answers/:questionId')
  save(
    @CurrentUser() user: AuthUser,
    @Client() client: ClientInfo,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(saveAnswerSchema)) body: SaveAnswerInput,
  ) {
    return this.attempts.saveAnswer(user, id, questionId, body, client);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Client() client: ClientInfo, @Param('id') id: string) {
    return this.attempts.submit(user, id, client);
  }

  @Post(':id/events/batch')
  @HttpCode(200)
  eventBatch(
    @CurrentUser() user: AuthUser,
    @Client() client: ClientInfo,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(proctorEventBatchSchema)) body: ProctorEventBatchInput,
  ) {
    return this.attempts.recordEvents(user, id, body.events, client);
  }

  @Post(':id/events')
  @HttpCode(200)
  event(
    @CurrentUser() user: AuthUser,
    @Client() client: ClientInfo,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(proctorEventSchema)) body: ProctorEventInput,
  ) {
    return this.attempts.recordEvent(user, id, body, client);
  }
}
