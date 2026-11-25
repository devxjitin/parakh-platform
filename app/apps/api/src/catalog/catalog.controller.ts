import { Controller, Get, Header, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { RATE, perMinute } from '../common/rate-limits';
import { SettingsService } from '../settings/settings.service';
import { CatalogService } from './catalog.service';

/** Public: anyone can see which exams are available. Short cache, so a new exam shows within a minute. */
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly settings: SettingsService,
  ) {}

  /** What the website shows as prices: the live platform settings, so an admin change shows up. */
  @Public()
  @Throttle({ default: perMinute(() => RATE.lookupIpPerMin) })
  @Header('Cache-Control', 'public, max-age=60')
  @Get('pricing')
  async pricing() {
    const s = await this.settings.get();
    return {
      examCreationPaise: s.examCreationPaise,
      examJoinPaise: s.examJoinPaise,
      examinerSharePercent: s.examinerSharePercent,
    };
  }

  @Public()
  @Throttle({ default: perMinute(() => RATE.lookupIpPerMin) })
  @Header('Cache-Control', 'public, max-age=60')
  @Get('exams')
  list() {
    return this.catalog.list();
  }

  @Public()
  @Throttle({ default: perMinute(() => RATE.lookupIpPerMin) })
  @Header('Cache-Control', 'public, max-age=60')
  @Get('exams/:code')
  one(@Param('code') code: string) {
    return this.catalog.one(code);
  }
}
