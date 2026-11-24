import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { OtpPurpose, User } from '@prisma/client';
import { LEGAL_VERSION, PRACTICE } from '@parakh/shared';
import type {
  AuthResponse,
  ChangePasswordInput,
  JoinStartInput,
  JoinVerifyInput,
  LoginInput,
  PublicUser,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-meta';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { normalizeCode } from '../enrollments/join-state';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

/** LoginFailure key that counts wrong practice codes per IP (no real email looks like this). */
const PRACTICE_LOCK_KEY = 'practice-code';

export interface Session {
  response: AuthResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

type UserWithProfile = User & { examinerProfile?: { orgName: string | null } | null };

export function toPublicUser(user: UserWithProfile): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    orgName: user.examinerProfile?.orgName ?? null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
    private readonly otp: OtpService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * A verified account that already owns the email is refused with a clear "already exists"
   * message (409), so the person signs in instead of waiting for a code. An unverified one is
   * not yet owned by anyone, so it is taken over and a fresh code is emailed.
   */
  async register(input: RegisterInput, meta: RequestMeta): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (existing) {
      if (existing.emailVerifiedAt) {
        throw new ConflictException(
          'An account with this email already exists. Please sign in, or use "Forgot password".',
        );
      } else {
        // Unverified: whoever registered first has not proven they own the mailbox. Replace the
        // stored credentials with this request's, so a squatter's password cannot survive the
        // real owner verifying the code that is emailed to them.
        await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: await this.passwords.hash(input.password),
            name: input.name,
            phone: input.phone,
            role: input.role,
            termsAcceptedAt: new Date(),
            termsVersion: LEGAL_VERSION,
          },
        });
        if (input.role === 'EXAMINER') {
          await this.prisma.examinerProfile.upsert({
            where: { userId: existing.id },
            create: { userId: existing.id, orgName: input.orgName ?? null },
            update: { orgName: input.orgName ?? null },
          });
        } else {
          await this.prisma.examinerProfile.deleteMany({ where: { userId: existing.id } });
        }
        await this.sendCode(existing, 'VERIFY_EMAIL');
      }
      return;
    }

    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        phone: input.phone,
        passwordHash,
        role: input.role,
        termsAcceptedAt: new Date(),
        termsVersion: LEGAL_VERSION,
        examinerProfile:
          input.role === 'EXAMINER' ? { create: { orgName: input.orgName ?? null } } : undefined,
      },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'auth.register',
      entity: 'User',
      entityId: user.id,
      meta: { role: user.role },
      ip: meta.ip,
    });
    await this.sendCode(user, 'VERIFY_EMAIL');
  }

  async verifyEmail(input: VerifyEmailInput, meta: RequestMeta): Promise<Session> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { examinerProfile: true },
    });
    if (!user || user.emailVerifiedAt) {
      // Same error as a wrong code, so this endpoint cannot be used to probe accounts.
      throw new BadRequestException('Invalid or expired code');
    }
    await this.otp.verify(user.id, 'VERIFY_EMAIL', input.code);

    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
      include: { examinerProfile: true },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'auth.verify_email',
      entity: 'User',
      entityId: user.id,
      ip: meta.ip,
    });
    return this.startSession(verified, meta);
  }

  async resendCode(email: string, purpose: OtpPurpose): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE' || user.role === 'STUDENT') return;
    // VERIFY_EMAIL is only for unverified accounts, RESET_PASSWORD only for verified ones.
    if (purpose === 'VERIFY_EMAIL' && user.emailVerifiedAt) return;
    if (purpose === 'RESET_PASSWORD' && !user.emailVerifiedAt) return;
    await this.sendCode(user, purpose);
  }

  /**
   * Step 1 of joining an exam: a student gives a name and email, and we mail a code. Students have
   * no password and no sign-up; the row created here is only a verified email address.
   */
  async joinStart(examCode: string, input: JoinStartInput, meta: RequestMeta): Promise<void> {
    const exam = await this.prisma.exam.findUnique({
      where: { code: normalizeCode(examCode) },
      select: { title: true, status: true, endsAt: true, sponsoredEmails: true },
    });
    if (!exam || exam.status !== 'PUBLISHED') throw new NotFoundException('Exam code not found');
    // The trainer paid for a fixed list: no seat for this email, no code and no way in.
    if (exam.sponsoredEmails.length > 0 && !exam.sponsoredEmails.includes(input.email)) {
      throw new ForbiddenException(
        'This exam is only for students the trainer invited. Use the email address the invitation was sent to.',
      );
    }

    let user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (user && user.role !== 'STUDENT') {
      throw new ConflictException(
        'This email belongs to a trainer or admin account. Use a different email to join as a student.',
      );
    }
    if (user && user.status !== 'ACTIVE') {
      throw new ForbiddenException('This account has been suspended. Contact support.');
    }
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          // Not a valid hash, so no password ever matches it: students cannot sign in with one.
          passwordHash: '!no-password',
          role: 'STUDENT',
          termsAcceptedAt: new Date(),
          termsVersion: LEGAL_VERSION,
        },
      });
      await this.audit.log({
        actorId: user.id,
        action: 'auth.join_start',
        entity: 'User',
        entityId: user.id,
        ip: meta.ip,
      });
    }
    // An existing student's name is only changed after they prove the email (joinVerify).
    // Too soon after the last code: say so (the student is waiting on an email that will not come).
    const code = await this.otp.issue(user.id, 'JOIN');
    await this.mail.sendJoinCode(
      user.email,
      user.emailVerifiedAt ? user.name : input.name,
      exam.title,
      code,
    );
  }

  /** Step 2: the emailed code proves the email and signs the student in for this visit. */
  async joinVerify(input: JoinVerifyInput, meta: RequestMeta): Promise<Session> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { examinerProfile: true },
    });
    if (!user || user.role !== 'STUDENT' || user.status !== 'ACTIVE') {
      throw new BadRequestException('Invalid or expired code');
    }
    await this.otp.verify(user.id, 'JOIN', input.code);
    const verified = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        name: input.name,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        termsAcceptedAt: new Date(),
        termsVersion: LEGAL_VERSION,
      },
      include: { examinerProfile: true },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'auth.join_verify',
      entity: 'User',
      entityId: user.id,
      ip: meta.ip,
    });
    return this.startSession(verified, meta);
  }

  /**
   * The practice code emailed after an exam closes opens that student's practice set. It stands in
   * for a sign-in: there is no password, and the code only exists for students who took the exam.
   */
  async practiceSignIn(rawCode: string, meta: RequestMeta): Promise<Session> {
    const invalid = new BadRequestException('That practice code is not valid');
    const ip = meta.ip ?? 'unknown';
    const pair = await this.prisma.loginFailure.findUnique({
      where: { email_ip: { email: PRACTICE_LOCK_KEY, ip } },
    });
    if (pair?.lockedUntil && pair.lockedUntil > new Date()) {
      throw new HttpException(
        'Too many wrong practice codes. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const normalized = code.startsWith('PRC') ? `PRC-${code.slice(3)}` : code;
    const access = await this.prisma.practiceAccess.findUnique({
      where: { code: normalized },
      include: {
        student: { include: { examinerProfile: true } },
        exam: { select: { endsAt: true, resultsPublishedAt: true, updatedAt: true } },
      },
    });
    if (!access || access.student.role !== 'STUDENT' || access.student.status !== 'ACTIVE') {
      await this.recordPairFailure(PRACTICE_LOCK_KEY, ip);
      throw invalid;
    }
    const closed = access.exam.endsAt ?? access.exam.resultsPublishedAt ?? access.exam.updatedAt;
    if (closed.getTime() + PRACTICE.EXPIRY_DAYS * 86_400_000 <= Date.now()) {
      throw new BadRequestException('This practice code has expired');
    }
    await this.audit.log({
      actorId: access.studentId,
      action: 'auth.practice_signin',
      entity: 'Exam',
      entityId: access.examId,
      ip: meta.ip,
    });
    await this.prisma.loginFailure.deleteMany({ where: { email: PRACTICE_LOCK_KEY, ip } });
    // The code is a shared secret in an email, so its session is short: no 30-day sign-in.
    return this.startSession(access.student, meta, PRACTICE.SESSION_HOURS * 3_600_000);
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<Session> {
    const ip = meta.ip ?? 'unknown';
    const pair = await this.prisma.loginFailure.findUnique({
      where: { email_ip: { email: input.email, ip } },
    });
    if (pair?.lockedUntil && pair.lockedUntil > new Date()) {
      throw new HttpException(
        'Too many failed attempts. Try again later or reset your password.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { examinerProfile: true },
    });

    if (!user) {
      await this.passwords.verifyDummy(input.password);
      await this.recordPairFailure(input.email, ip);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        'Too many failed attempts. Try again later or reset your password.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const passwordOk =
      user.role !== 'STUDENT' && (await this.passwords.verify(user.passwordHash, input.password));
    if (!passwordOk) {
      await this.recordPairFailure(input.email, ip);
      await this.recordFailedLogin(user, meta);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('This account has been suspended. Contact support.');
    }

    if (!user.emailVerifiedAt) {
      // Only someone who knows the password learns this, and gets a fresh code to finish signing up.
      await this.sendCode(user, 'VERIFY_EMAIL');
      throw new ForbiddenException({
        statusCode: 403,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email. We sent you a new code.',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    await this.prisma.loginFailure.deleteMany({ where: { email: input.email, ip } });
    await this.audit.log({
      actorId: user.id,
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      ip: meta.ip,
    });
    return this.startSession(user, meta);
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<Session> {
    const rotated = await this.tokens.rotate(rawToken, meta);
    const user = await this.prisma.user.findUnique({
      where: { id: rotated.userId },
      include: { examinerProfile: true },
    });
    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) {
      await this.tokens.revokeAllForUser(rotated.userId);
      throw new UnauthorizedException('Account is not active');
    }
    return {
      response: this.buildResponse(user),
      refreshToken: rotated.token,
      refreshExpiresAt: rotated.expiresAt,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    await this.tokens.revoke(rawToken);
  }

  async forgotPassword(email: string): Promise<void> {
    await this.resendCode(email, 'RESET_PASSWORD');
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !user.emailVerifiedAt) {
      throw new BadRequestException('Invalid or expired code');
    }
    await this.otp.verify(user.id, 'RESET_PASSWORD', input.code);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(input.newPassword),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // Sign the user out everywhere: whoever had access before can no longer refresh.
    await this.tokens.revokeAllForUser(user.id);
    await this.audit.log({
      actorId: user.id,
      action: 'auth.password_reset',
      entity: 'User',
      entityId: user.id,
      ip: meta.ip,
    });
    await this.mail.sendPasswordChanged(user.email, user.name);
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    meta: RequestMeta,
  ): Promise<Session> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { examinerProfile: true },
    });
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(input.newPassword) },
    });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.log({
      actorId: userId,
      action: 'auth.password_changed',
      entity: 'User',
      entityId: userId,
      ip: meta.ip,
    });
    await this.mail.sendPasswordChanged(user.email, user.name);
    return this.startSession(user, meta);
  }

  /** Counts a failure for this email from this IP and locks the pair after too many. */
  private async recordPairFailure(email: string, ip: string): Promise<void> {
    const row = await this.prisma.loginFailure.upsert({
      where: { email_ip: { email, ip } },
      create: { email, ip, count: 1 },
      update: { count: { increment: 1 } },
    });
    if (row.count >= this.env.LOGIN_MAX_FAILURES) {
      await this.prisma.loginFailure.update({
        where: { email_ip: { email, ip } },
        data: { count: 0, lockedUntil: new Date(Date.now() + this.env.LOCK_MINUTES * 60_000) },
      });
    }
  }

  private async recordFailedLogin(user: User, meta: RequestMeta): Promise<void> {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= this.env.ACCOUNT_LOCK_FAILURES;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + this.env.LOCK_MINUTES * 60_000) : undefined,
      },
    });
    await this.audit.log({
      actorId: user.id,
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      entity: 'User',
      entityId: user.id,
      ip: meta.ip,
    });
  }

  private async sendCode(user: User, purpose: OtpPurpose): Promise<void> {
    let code: string;
    try {
      code = await this.otp.issue(user.id, purpose);
    } catch (err) {
      // Too soon after the previous code: the earlier email is still valid, so do nothing.
      if (err instanceof HttpException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS) return;
      throw err;
    }
    if (purpose === 'VERIFY_EMAIL') {
      await this.mail.sendVerificationCode(user.email, user.name, code);
    } else {
      await this.mail.sendPasswordResetCode(user.email, user.name, code);
    }
  }

  private async startSession(
    user: UserWithProfile,
    meta: RequestMeta,
    ttlMs?: number,
  ): Promise<Session> {
    const refresh = await this.tokens.issueRefresh(user.id, meta, undefined, ttlMs);
    return {
      response: this.buildResponse(user),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private buildResponse(user: UserWithProfile): AuthResponse {
    return {
      accessToken: this.tokens.signAccess(user),
      expiresInSeconds: this.tokens.accessTtlSeconds,
      user: toPublicUser(user),
    };
  }
}
