import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { monthSchema, platformSettingsSchema, type PlatformSettings } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import { TokensService } from '../auth/tokens.service';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { requestMeta } from '../common/request-meta';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AdminReportsService } from './admin-reports.service';

const listQuerySchema = z.object({
  role: z.enum(['STUDENT', 'EXAMINER', 'ADMIN']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const examsQuery = pageQuery.extend({
  status: z.string().max(40).optional(),
  q: z.string().trim().max(100).optional(),
});
const trainersQuery = pageQuery.extend({ q: z.string().trim().max(100).optional() });
const auditQuery = pageQuery.extend({ action: z.string().trim().max(60).optional() });
const monthQuery = z.object({ month: monthSchema });
const seriesQuery = z.object({ months: z.coerce.number().int().min(1).max(24).default(12) });

const statusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) });

/** NandiVex staff only. The whole controller is restricted to the ADMIN role. */
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly reports: AdminReportsService,
    private readonly settings: SettingsService,
  ) {}

  @Get('users')
  async listUsers(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery) {
    const where = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' as const } },
              { name: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          createdAt: true,
        },
      }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, users };
  }

  @Patch('users/:id/status')
  async setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(statusSchema)) body: z.infer<typeof statusSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    if (id === actor.id) throw new BadRequestException('You cannot change your own status');
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    await this.prisma.user.update({ where: { id }, data: { status: body.status } });
    if (body.status === 'SUSPENDED') await this.tokens.revokeAllForUser(id);

    await this.audit.log({
      actorId: actor.id,
      action: body.status === 'SUSPENDED' ? 'admin.user_suspended' : 'admin.user_reactivated',
      entity: 'User',
      entityId: id,
      ip: requestMeta(req).ip,
    });
    return { id, status: body.status };
  }

  /** Marks an email as verified (for a user who cannot get the code, e.g. a migrated account). */
  @Patch('users/:id/verify')
  async verifyUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    if (!target.emailVerifiedAt) {
      await this.prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
      await this.audit.log({
        actorId: actor.id,
        action: 'admin.user_verified',
        entity: 'User',
        entityId: id,
        ip: requestMeta(req).ip,
      });
    }
    return { id, verified: true };
  }

  /** Always-open attempts waiting for their written answers to be marked. */
  @Get('reviews')
  reviews() {
    return this.reports.reviewQueue();
  }

  @Get('overview')
  overview() {
    return this.reports.overview();
  }

  /** "How much did we earn and owe this month?" */
  @Get('reports/monthly')
  monthly(@Query(new ZodValidationPipe(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.reports.monthly(q.month);
  }

  @Get('reports/series')
  series(@Query(new ZodValidationPipe(seriesQuery)) q: z.infer<typeof seriesQuery>) {
    return this.reports.series(q.months);
  }

  /** Per-trainer money: collected from students, trainer share, paid out, still owed. */
  @Get('trainers/collections')
  trainerCollections(
    @Query(new ZodValidationPipe(trainersQuery)) q: z.infer<typeof trainersQuery>,
  ) {
    return this.reports.trainerCollections(q);
  }

  @Get('exams')
  exams(@Query(new ZodValidationPipe(examsQuery)) q: z.infer<typeof examsQuery>) {
    return this.reports.exams(q);
  }

  @Get('audit')
  auditLog(@Query(new ZodValidationPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.reports.audit(q);
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  async putSettings(
    @Body(new ZodValidationPipe(platformSettingsSchema)) body: PlatformSettings,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const before = await this.settings.get();
    const after = await this.settings.update(body, actor.id);
    await this.audit.log({
      actorId: actor.id,
      action: 'admin.settings_changed',
      entity: 'PlatformSetting',
      entityId: 'platform',
      meta: { before, after },
      ip: requestMeta(req).ip,
    });
    return after;
  }
}
