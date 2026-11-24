import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { AuditService } from '../audit/audit.service';
import {
  ReconciliationReport,
  ReconciliationService,
  previousIstDay,
} from './reconciliation.service';

@Controller()
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
  ) {}

  /** Admin: compare one IST day of Razorpay payments with the database now (default: yesterday). */
  @Roles('ADMIN')
  @Post('admin/finance/reconcile')
  @HttpCode(200)
  async run(
    @CurrentUser() admin: AuthUser,
    @Body() body: { day?: unknown } | undefined,
  ): Promise<ReconciliationReport> {
    const day = body?.day === undefined ? previousIstDay() : body.day;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new BadRequestException('day must be a date like 2026-11-22');
    }
    let report: ReconciliationReport;
    try {
      report = await this.reconciliation.reconcile(day);
    } catch (err) {
      if (err instanceof RangeError) throw new BadRequestException(err.message);
      throw err;
    }
    await this.audit.log({
      actorId: admin.id,
      action: 'payment.reconciliation.manual',
      entity: 'Reconciliation',
      entityId: day,
      meta: { matched: report.matched, mismatches: report.mismatches.length },
    });
    return report;
  }
}
