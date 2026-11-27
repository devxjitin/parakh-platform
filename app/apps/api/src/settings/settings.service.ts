import { Inject, Injectable } from '@nestjs/common';
import { PRICING, platformSettingsSchema, type PlatformSettings } from '@parakh/shared';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

const KEY = 'platform';
const TTL_MS = 15_000;

export const DEFAULT_SETTINGS: PlatformSettings = {
  examCreationPaise: PRICING.EXAM_CREATION_PAISE,
  examJoinPaise: PRICING.EXAM_JOIN_PAISE,
  examinerSharePercent: PRICING.EXAMINER_SHARE_PERCENT,
  minPayoutPaise: PRICING.MIN_PAYOUT_PAISE,
  paymentFlow: 'checkout',
};

/** Prices and the trainer's share. Edited by NandiVex admins; the code defaults apply until then. */
@Injectable()
export class SettingsService {
  private cached?: { at: number; value: PlatformSettings };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async get(): Promise<PlatformSettings> {
    const useCache = process.env.NODE_ENV !== 'test';
    if (useCache && this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.value;
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    // A stored value that no longer fits the rules falls back to the defaults, never to nothing.
    // The payment flow starts as the PAYMENT_FLOW setting of the server, until an admin saves one.
    const defaults: PlatformSettings = { ...DEFAULT_SETTINGS, paymentFlow: this.env.PAYMENT_FLOW };
    const parsed = platformSettingsSchema.safeParse({
      ...defaults,
      ...(row?.value as object),
    });
    const value = parsed.success ? parsed.data : defaults;
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(value: PlatformSettings, actorId: string): Promise<PlatformSettings> {
    await this.prisma.platformSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value, updatedBy: actorId },
      update: { value, updatedBy: actorId },
    });
    this.cached = undefined;
    return this.get();
  }
}
