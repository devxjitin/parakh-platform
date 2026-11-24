import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { OtpPurpose } from '@prisma/client';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OtpService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
  ) {}

  private hash(code: string, userId: string, purpose: OtpPurpose): string {
    return createHmac('sha256', this.env.OTP_SECRET)
      .update(`${userId}:${purpose}:${code}`)
      .digest('hex');
  }

  /** Creates a new 6-digit code, invalidating older ones. Throws 429 if one was sent very recently. */
  async issue(userId: string, purpose: OtpPurpose): Promise<string> {
    const latest = await this.prisma.emailOtp.findFirst({
      where: { userId, purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      const waitMs = this.env.OTP_RESEND_SECONDS * 1000 - (Date.now() - latest.createdAt.getTime());
      if (waitMs > 0) {
        throw new HttpException(
          `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting another code`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.prisma.emailOtp.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.emailOtp.create({
      data: {
        userId,
        purpose,
        codeHash: this.hash(code, userId, purpose),
        expiresAt: new Date(Date.now() + this.env.OTP_TTL_MIN * 60_000),
      },
    });
    return code;
  }

  /** Checks a code. Consumes it on success; counts the attempt and may lock the code on failure. */
  async verify(userId: string, purpose: OtpPurpose, code: string): Promise<void> {
    const invalid = new BadRequestException('Invalid or expired code');

    const otp = await this.prisma.emailOtp.findFirst({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.attempts >= this.env.OTP_MAX_ATTEMPTS) throw invalid;

    // Claim an attempt first, atomically, so parallel guesses cannot slip past the limit.
    const claimed = await this.prisma.emailOtp.updateMany({
      where: { id: otp.id, consumedAt: null, attempts: { lt: this.env.OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (claimed.count === 0) throw invalid;

    const expected = Buffer.from(otp.codeHash);
    const actual = Buffer.from(this.hash(code, userId, purpose));
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!ok) throw invalid;

    // Only one request can consume a code.
    const consumed = await this.prisma.emailOtp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw invalid;
  }
}
