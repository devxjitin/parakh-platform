import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestMeta } from '../common/request-meta';

const ISSUER = 'parakh';

export interface AccessPayload {
  sub: string;
  role: Role;
}

/**
 * A token that was just rotated is still honoured for this long. Two tabs opened together send the
 * same cookie; the slower one must not be treated as a stolen-token replay.
 */
const REUSE_GRACE_MS = 30_000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TokensService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get accessTtlSeconds(): number {
    return this.env.ACCESS_TTL_MIN * 60;
  }

  signAccess(user: { id: string; role: Role }): string {
    return jwt.sign({ role: user.role }, this.env.JWT_ACCESS_SECRET, {
      subject: user.id,
      issuer: ISSUER,
      algorithm: 'HS256',
      expiresIn: this.accessTtlSeconds,
    });
  }

  verifyAccess(token: string): AccessPayload {
    try {
      const payload = jwt.verify(token, this.env.JWT_ACCESS_SECRET, {
        issuer: ISSUER,
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;
      if (!payload.sub) throw new Error('missing subject');
      return { sub: payload.sub, role: payload.role as Role };
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /** Creates an opaque refresh token "<id>.<secret>"; only a hash of the secret is stored. */
  async issueRefresh(
    userId: string,
    meta: RequestMeta,
    familyId: string = randomUUID(),
    ttlMs: number = this.env.REFRESH_TTL_DAYS * 86_400_000,
  ) {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.refreshToken.create({
      data: {
        id,
        userId,
        familyId,
        tokenHash: sha256(secret),
        expiresAt,
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    return { token: `${id}.${secret}`, expiresAt, id };
  }

  /**
   * Exchanges a refresh token for a new one (rotation). Presenting an already-used token means it
   * was probably stolen, so the whole token family is revoked.
   */
  async rotate(rawToken: string | undefined, meta: RequestMeta) {
    const parsed = this.parse(rawToken);
    if (!parsed) throw new UnauthorizedException('Invalid refresh token');

    const record = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } });
    if (!record || !this.matches(record.tokenHash, parsed.secret)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Just rotated by a parallel request (another tab): hand out a sibling token, keep the family.
    const withinGrace =
      record.revokedAt &&
      record.replacedById &&
      Date.now() - record.revokedAt.getTime() <= REUSE_GRACE_MS &&
      record.expiresAt > new Date();

    if (record.revokedAt && !withinGrace) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log({
        actorId: record.userId,
        action: 'auth.refresh_reuse_detected',
        entity: 'RefreshToken',
        entityId: record.id,
        ip: meta.ip,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');

    // A rotated token keeps the lifetime it started with (short practice sessions stay short).
    const ttlMs = record.expiresAt.getTime() - record.createdAt.getTime();
    const next = await this.issueRefresh(record.userId, meta, record.familyId, ttlMs);
    if (!record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: next.id },
      });
    }
    return { userId: record.userId, ...next };
  }

  async revoke(rawToken: string | undefined): Promise<void> {
    const parsed = this.parse(rawToken);
    if (!parsed) return;
    const record = await this.prisma.refreshToken.findUnique({ where: { id: parsed.id } });
    if (record && this.matches(record.tokenHash, parsed.secret)) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private parse(raw: string | undefined): { id: string; secret: string } | null {
    if (!raw) return null;
    const dot = raw.indexOf('.');
    if (dot < 1) return null;
    const id = raw.slice(0, dot);
    const secret = raw.slice(dot + 1);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !secret) return null;
    return { id, secret };
  }

  private matches(storedHash: string, secret: string): boolean {
    const a = Buffer.from(storedHash);
    const b = Buffer.from(sha256(secret));
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
