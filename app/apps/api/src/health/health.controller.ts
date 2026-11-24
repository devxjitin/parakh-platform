import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BRAND } from '@parakh/shared';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    let database = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unreachable';
    }
    // 503 when the database cannot be reached, so health checks and alarms see a real failure.
    if (database !== 'ok') res.status(503);
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      service: `${BRAND.PRODUCT} API`,
      database,
      time: new Date().toISOString(),
    };
  }
}
