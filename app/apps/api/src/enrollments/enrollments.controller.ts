import { Controller, Get, Param, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import { RATE, perMinute } from '../common/rate-limits';
import { requestMeta } from '../common/request-meta';
import { EnrollmentsService } from './enrollments.service';

@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  /**
   * Looks up an exam by code. Public: the student has no account yet, and sees the exam before
   * giving their email. Rate limited so codes cannot be guessed in bulk.
   */
  @Public()
  @Throttle({ default: perMinute(() => RATE.lookupIpPerMin) })
  @Get('join/:code')
  joinInfo(@Param('code') code: string, @Req() req: Request) {
    return this.enrollments.joinInfo(code, requestMeta(req).ip);
  }

  /** The signed-in student's seat for one exam (after the email code), to start or resume it. */
  @Roles('STUDENT')
  @Get('join/:code/mine')
  myEnrollment(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.enrollments.myForCode(user, code);
  }

  @Roles('STUDENT')
  @Get('me/enrollments')
  mine(@CurrentUser() user: AuthUser) {
    return this.enrollments.mine(user);
  }
}
