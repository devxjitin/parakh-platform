import { Injectable } from '@nestjs/common';
import type { ExamStatus, Prisma } from '@prisma/client';
import {
  ACCOUNTS,
  type AdminExamRowDto,
  type AdminOverviewDto,
  type AuditRowDto,
  type MonthlyReportDto,
  type PageDto,
  type ReviewQueueDto,
  REVIEW_PROMISE_HOURS,
  type SeriesPointDto,
  type TrainerCollectionRowDto,
  type TrainerCollectionsDto,
} from '@parakh/shared';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';

/** Months follow the Indian calendar: a month starts at midnight India time. */
const IST_MS = 5.5 * 3_600_000;

export function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - IST_MS),
    end: new Date(Date.UTC(y, m, 1) - IST_MS),
  };
}

export function monthOf(date: Date): string {
  const d = new Date(date.getTime() + IST_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const sum = (n: number | null | undefined) => n ?? 0;

@Injectable()
export class AdminReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  // ------------------------------------------------------------------ money

  /** Money for one month: what came in, what NandiVex kept, what trainers earned and are owed. */
  async monthly(month: string): Promise<MonthlyReportDto> {
    const { start, end } = monthRange(month);
    const inMonth = await this.prisma.ledgerEntry.groupBy({
      by: ['account', 'type'],
      where: { createdAt: { gte: start, lt: end } },
      _sum: { amountPaise: true },
    });
    let gross = 0;
    let refunded = 0;
    let platform = 0;
    let earned = 0;
    let paid = 0;
    const earnedBy = new Map<string, number>();
    const paidBy = new Map<string, number>();
    for (const r of inMonth) {
      const amount = sum(r._sum.amountPaise);
      if (r.account === ACCOUNTS.EXTERNAL) {
        if (r.type === 'CREDIT') gross += -amount;
        else if (r.type === 'REFUND') refunded += amount;
      } else if (r.account === ACCOUNTS.PLATFORM) {
        platform += amount;
      } else if (r.account.startsWith('EXAMINER:')) {
        const id = r.account.slice('EXAMINER:'.length);
        if (r.type === 'PAYOUT') {
          paidBy.set(id, (paidBy.get(id) ?? 0) + -amount);
          paid += -amount;
        } else {
          earnedBy.set(id, (earnedBy.get(id) ?? 0) + amount);
          earned += amount;
        }
      }
    }

    const owedRows = await this.prisma.ledgerEntry.groupBy({
      by: ['account'],
      where: { account: { startsWith: 'EXAMINER:' }, createdAt: { lt: end } },
      _sum: { amountPaise: true },
    });
    const owedBy = new Map(
      owedRows.map((r) => [r.account.slice('EXAMINER:'.length), sum(r._sum.amountPaise)]),
    );

    const ids = [...new Set([...earnedBy.keys(), ...paidBy.keys(), ...owedBy.keys()])];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    const who = new Map(users.map((u) => [u.id, u]));
    const examiners = ids
      .map((id) => ({
        examinerId: id,
        name: who.get(id)?.name ?? 'Unknown',
        email: who.get(id)?.email ?? '',
        earnedPaise: earnedBy.get(id) ?? 0,
        paidOutPaise: paidBy.get(id) ?? 0,
        owedAtMonthEndPaise: owedBy.get(id) ?? 0,
      }))
      .filter((e) => e.earnedPaise || e.paidOutPaise || e.owedAtMonthEndPaise)
      .sort((a, b) => b.owedAtMonthEndPaise - a.owedAtMonthEndPaise);

    let payableNow = 0;
    for (const id of owedBy.keys()) {
      payableNow += (await this.ledger.balances(id)).payablePaise;
    }

    return {
      month,
      grossPaise: gross,
      refundedPaise: refunded,
      platformRevenuePaise: platform,
      examinerEarnedPaise: earned,
      paidOutPaise: paid,
      owedAtMonthEndPaise: examiners.reduce((s, e) => s + e.owedAtMonthEndPaise, 0),
      payableNowPaise: payableNow,
      examiners,
    };
  }

  /** The last N months (oldest first) for the revenue chart. */
  async series(months: number): Promise<SeriesPointDto[]> {
    const last = monthOf(new Date());
    const out: SeriesPointDto[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const month = addMonths(last, -i);
      const { start, end } = monthRange(month);
      const rows = await this.prisma.ledgerEntry.groupBy({
        by: ['account', 'type'],
        where: { createdAt: { gte: start, lt: end } },
        _sum: { amountPaise: true },
      });
      const point: SeriesPointDto = {
        month,
        grossPaise: 0,
        refundedPaise: 0,
        platformRevenuePaise: 0,
        examinerEarnedPaise: 0,
        paidOutPaise: 0,
      };
      for (const r of rows) {
        const amount = sum(r._sum.amountPaise);
        if (r.account === ACCOUNTS.EXTERNAL) {
          if (r.type === 'CREDIT') point.grossPaise += -amount;
          else if (r.type === 'REFUND') point.refundedPaise += amount;
        } else if (r.account === ACCOUNTS.PLATFORM) point.platformRevenuePaise += amount;
        else if (r.account.startsWith('EXAMINER:')) {
          if (r.type === 'PAYOUT') point.paidOutPaise += -amount;
          else point.examinerEarnedPaise += amount;
        }
      }
      out.push(point);
    }
    return out;
  }

  // --------------------------------------------------------------- overview

  async overview(): Promise<AdminOverviewDto> {
    const [roles, suspended, exams, live, awaiting, enrollments, payoutRequests, certs, check] =
      await Promise.all([
        this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
        this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
        this.prisma.exam.count(),
        this.prisma.exam.count({
          where: { status: 'PUBLISHED', OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        }),
        this.prisma.exam.count({ where: { status: 'PUBLISHED', endsAt: { lte: new Date() } } }),
        this.prisma.enrollment.count(),
        this.prisma.payout.count({ where: { status: 'REQUESTED' } }),
        this.prisma.certificate.count({ where: { status: 'GENERATED' } }),
        this.ledger.check(),
      ]);
    const n = (r: string) => roles.find((x) => x.role === r)?._count._all ?? 0;
    return {
      users: {
        students: n('STUDENT'),
        examiners: n('EXAMINER'),
        admins: n('ADMIN'),
        suspended,
      },
      exams: { total: exams, live, awaitingResults: awaiting },
      enrollments,
      waiting: { payoutRequests, certificates: certs },
      ledgerBalanced: check.totalPaise === 0 && check.unbalancedTransactions.length === 0,
    };
  }

  // ------------------------------------------------------------- exams, audit

  async exams(q: {
    status?: string;
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<PageDto<AdminExamRowDto>> {
    const like = (field: string) => ({ [field]: { contains: q.q, mode: 'insensitive' as const } });
    const where: Prisma.ExamWhereInput = {
      ...(q.status ? { status: q.status as ExamStatus } : {}),
      ...(q.q
        ? {
            OR: [
              like('title'),
              like('code'),
              { examiner: like('email') },
              { examiner: like('name') },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.exam.count({ where }),
      this.prisma.exam.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          examiner: { select: { name: true, email: true } },
          _count: { select: { enrollments: true, attempts: true } },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      rows: rows.map((e) => ({
        id: e.id,
        title: e.title,
        code: e.code,
        status: e.status,
        trainerName: e.examiner.name,
        trainerEmail: e.examiner.email,
        enrollments: e._count.enrollments,
        attempts: e._count.attempts,
        startsAt: e.startsAt?.toISOString() ?? null,
        endsAt: e.endsAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async audit(q: {
    action?: string;
    page: number;
    pageSize: number;
  }): Promise<PageDto<AuditRowDto>> {
    const where = q.action ? { action: { contains: q.action } } : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });
    const name = new Map(actors.map((a) => [a.id, a.name]));
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      rows: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorName: r.actorId ? (name.get(r.actorId) ?? null) : null,
        entity: r.entity,
        entityId: r.entityId,
        ip: r.ip,
        meta: r.meta,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------- trainers

  /**
   * "How much has been collected for each trainer?" Student payments (join fees, sponsored seats)
   * on the trainer's exams, after refunds, next to the trainer's share and what was paid out.
   */
  async trainerCollections(q: {
    q?: string;
    page: number;
    pageSize: number;
  }): Promise<TrainerCollectionsDto> {
    const like = (field: string) => ({ [field]: { contains: q.q, mode: 'insensitive' as const } });
    const where: Prisma.UserWhereInput = {
      role: 'EXAMINER',
      ...(q.q ? { OR: [like('name'), like('email')] } : {}),
    };
    const [total, trainers] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, name: true, email: true },
      }),
    ]);

    const exams = await this.prisma.exam.findMany({
      where: { examinerId: { in: trainers.map((t) => t.id) } },
      select: { id: true, title: true, code: true, status: true, examinerId: true },
      orderBy: { createdAt: 'desc' },
    });
    const paid = await this.prisma.payment.groupBy({
      by: ['examId', 'status'],
      where: {
        examId: { in: exams.map((e) => e.id) },
        purpose: 'EXAM_JOIN',
        status: { in: ['CAPTURED', 'PENDING_REFUND', 'REFUNDED'] },
      },
      _sum: { amountPaise: true },
      _count: { _all: true },
    });
    const byExam = new Map<string, { payments: number; received: number; refunded: number }>();
    for (const r of paid) {
      if (!r.examId) continue;
      const cur = byExam.get(r.examId) ?? { payments: 0, received: 0, refunded: 0 };
      cur.payments += r._count._all;
      cur.received += sum(r._sum.amountPaise);
      if (r.status === 'REFUNDED') cur.refunded += sum(r._sum.amountPaise);
      byExam.set(r.examId, cur);
    }

    const rows: TrainerCollectionRowDto[] = [];
    for (const t of trainers) {
      const mine = exams.filter((e) => e.examinerId === t.id);
      const perExam = mine
        .map((e) => {
          const m = byExam.get(e.id) ?? { payments: 0, received: 0, refunded: 0 };
          return {
            examId: e.id,
            title: e.title,
            code: e.code,
            status: e.status,
            payments: m.payments,
            collectedPaise: m.received - m.refunded,
            refundedPaise: m.refunded,
          };
        })
        .filter((e) => e.payments > 0);
      const b = await this.ledger.balances(t.id);
      const releasedNet = b.netPaise; // released minus paid out
      rows.push({
        examinerId: t.id,
        name: t.name,
        email: t.email,
        exams: mine.length,
        payments: perExam.reduce((s, e) => s + e.payments, 0),
        collectedPaise: perExam.reduce((s, e) => s + e.collectedPaise, 0),
        refundedPaise: perExam.reduce((s, e) => s + e.refundedPaise, 0),
        shareEarnedPaise: releasedNet + b.paidPaise + b.accruedPaise,
        paidOutPaise: b.paidPaise,
        accruingPaise: b.accruedPaise,
        payableNowPaise: b.payablePaise,
        perExam,
      });
    }
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      rows,
      totals: {
        collectedPaise: rows.reduce((s, r) => s + r.collectedPaise, 0),
        shareEarnedPaise: rows.reduce((s, r) => s + r.shareEarnedPaise, 0),
        paidOutPaise: rows.reduce((s, r) => s + r.paidOutPaise, 0),
      },
    };
  }
  /**
   * Always-open attempts waiting for an admin to mark their written answers, oldest first. A
   * student is promised a result within REVIEW_PROMISE_HOURS of submitting.
   */
  async reviewQueue(): Promise<ReviewQueueDto> {
    const attempts = await this.prisma.attempt.findMany({
      where: {
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
        exam: { alwaysOpen: true },
      },
      orderBy: { submittedAt: 'asc' },
      take: 200,
      include: {
        student: { select: { name: true, email: true } },
        exam: {
          select: { id: true, title: true, questions: { select: { id: true, type: true } } },
        },
        answers: { select: { questionId: true, text: true, marksAwarded: true } },
      },
    });
    const dueMs = REVIEW_PROMISE_HOURS * 3_600_000;
    const items = attempts.flatMap((a) => {
      const written = new Set(
        a.exam.questions.filter((q) => q.type === 'SUBJECTIVE').map((q) => q.id),
      );
      const pending = a.answers.filter(
        (x) => written.has(x.questionId) && x.text?.trim() && x.marksAwarded === null,
      ).length;
      if (pending === 0) return [];
      const submittedAt = a.submittedAt ?? a.deadlineAt;
      return [
        {
          attemptId: a.id,
          examId: a.exam.id,
          examTitle: a.exam.title,
          studentName: a.student.name,
          studentEmail: a.student.email,
          submittedAt: submittedAt.toISOString(),
          pendingAnswers: pending,
          overdue: Date.now() - submittedAt.getTime() > dueMs,
        },
      ];
    });
    return { items };
  }
}
