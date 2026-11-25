import { Controller, Get, Header, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { RATE, perMinute } from '../common/rate-limits';
import { CatalogService } from './catalog.service';

/** Public: anyone can see which exams are available. Short cache, so a new exam shows within a minute. */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

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
