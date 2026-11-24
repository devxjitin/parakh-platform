import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AuthResponse,
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type DeleteAccountInput,
  type PublicUser,
  type UpdateProfileInput,
} from '@parakh/shared';
import { AuthService } from '../auth/auth.service';
import { REFRESH_COOKIE } from '../auth/auth.controller';
import { AuthUser, CurrentUser } from '../common/decorators';
import { requestMeta } from '../common/request-meta';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { Inject } from '@nestjs/common';
import { AccountService } from './account.service';
import { UsersService } from './users.service';

@Controller('users/me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly account: AccountService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<PublicUser> {
    return this.users.getProfile(user.id);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Req() req: Request,
  ): Promise<PublicUser> {
    return this.users.updateProfile(user, body, requestMeta(req));
  }

  /** Everything we hold about the signed-in user, as a JSON file. */
  @Get('data')
  async data(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const body = await this.account.exportData(user);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="parakh-my-data.json"');
    res.send(JSON.stringify(body, null, 2));
  }

  /** Closes the account: personal details are wiped, money and certificate records stay. */
  @Post('delete')
  @HttpCode(200)
  async delete(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(deleteAccountSchema)) body: DeleteAccountInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.account.deleteAccount(user, body.password, requestMeta(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return { deleted: true as const };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const session = await this.auth.changePassword(user.id, body, requestMeta(req));
    // All old sessions were revoked; this response carries the fresh one.
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.env.cookieSecure,
      sameSite: 'lax',
      path: '/auth',
      expires: session.refreshExpiresAt,
    });
    return session.response;
  }
}
