import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash, Algorithm } from '@node-rs/argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { MAIL_TRANSPORT } from '../src/mail/mail.service';
import { MemoryTransport } from '../src/mail/transports';
import { TokensService } from '../src/auth/tokens.service';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'CorrectHorse9battery';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  mail: MemoryTransport;
  http: () => ReturnType<typeof request>;
  reset: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const mail = app.get<MemoryTransport>(MAIL_TRANSPORT);

  return {
    app,
    prisma,
    mail,
    http: () => request(app.getHttpServer()),
    reset: async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "PlatformSetting", "AuditLog", "EmailEvent", "LedgerEntry", "Payout", "SeatPack", "Seat", "ProctorEvent", "Answer", "Attempt", "Enrollment", "WebhookEvent", "Payment", "Question", "Exam", "RefreshToken", "EmailOtp", "LoginFailure", "ExaminerProfile", "User" CASCADE',
      );
      // The suite's money tests were written against these prices, so they are stored explicitly
      // and do not move when the platform's default prices change.
      await prisma.platformSetting.create({
        data: {
          key: 'platform',
          value: {
            examCreationPaise: 19_900,
            examJoinPaise: 14_900,
            examinerSharePercent: 50,
            minPayoutPaise: 50_000,
          },
        },
      });
      mail.clear();
    },
  };
}

/** Pulls the 6-digit code out of the most recent email sent to an address. */
export function lastCode(mail: MemoryTransport, email: string): string {
  const message = mail.lastTo(email);
  const match = message?.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`No code found in the last email to ${email}`);
  return match[1];
}

/** Returns the prk_rt cookie (name=value) from a response, or undefined. */
export function refreshCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('prk_rt='))?.split(';')[0];
}

export function rawSetCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('prk_rt=')) ?? '';
}

/** Registers and verifies a user through the real endpoints. */
export async function signUp(
  ctx: TestContext,
  overrides: Partial<{
    email: string;
    role: 'STUDENT' | 'EXAMINER';
    name: string;
    orgName: string;
  }> = {},
) {
  const email = overrides.email ?? `user${Math.random().toString(36).slice(2, 8)}@example.com`;
  if ((overrides.role ?? 'EXAMINER') === 'STUDENT')
    return signUpStudent(ctx, email, overrides.name);
  await ctx
    .http()
    .post('/auth/register')
    .send({
      acceptTerms: true,
      name: overrides.name ?? 'Test User',
      email,
      password: PASSWORD,
      role: 'EXAMINER',
      orgName: overrides.orgName,
    })
    .expect(202);
  const res = await ctx
    .http()
    .post('/auth/verify-email')
    .send({ email, code: lastCode(ctx.mail, email) })
    .expect(200);
  return { email, accessToken: res.body.accessToken as string, cookie: refreshCookie(res)!, res };
}

/**
 * Students have no sign-up: they prove an email at join time. Tests that only need a signed-in
 * student create the verified row directly and sign a session for it (see joinAsStudent for the
 * real flow).
 */
async function signUpStudent(ctx: TestContext, email: string, name = 'Test User') {
  const user = await ctx.prisma.user.create({
    data: {
      email,
      name,
      passwordHash: '!no-password',
      role: 'STUDENT',
      emailVerifiedAt: new Date(),
    },
  });
  const tokens = ctx.app.get(TokensService);
  const refresh = await tokens.issueRefresh(user.id, { ip: null, userAgent: null });
  return {
    email,
    accessToken: tokens.signAccess(user),
    cookie: `prk_rt=${refresh.token}`,
    res: undefined as unknown as request.Response,
  };
}

/** Admins cannot self-register, so tests insert one directly. */
export async function createAdmin(ctx: TestContext, email = 'admin@example.com') {
  const passwordHash = await hash(PASSWORD, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await ctx.prisma.user.create({
    data: { email, name: 'Admin', passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() },
  });
  const res = await ctx.http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { email, accessToken: res.body.accessToken as string };
}
