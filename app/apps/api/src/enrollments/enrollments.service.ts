import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  INTEGRITY,
  pricingMode,
  studentJoinFee,
  type EnrollmentDto,
  type JoinInfoDto,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { canRetake, computeJoinState, normalizeCode } from './join-state';

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** What a student sees after typing a code, before giving their email or paying. */
  async joinInfo(rawCode: string, ip: string | null): Promise<JoinInfoDto> {
    // Guessing codes: too many wrong ones from one network in a short time pauses its lookups.
    const misses = await this.prisma.auditLog.count({
      where: {
        ip: ip ?? 'unknown',
        action: 'join.miss',
        createdAt: { gt: new Date(Date.now() - INTEGRITY.JOIN_MISS_WINDOW_MS) },
      },
    });
    if (misses >= INTEGRITY.JOIN_MISS_LIMIT) {
      throw new HttpException(
        'Too many wrong exam codes. Wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const exam = await this.prisma.exam.findUnique({
      where: { code: normalizeCode(rawCode) },
      include: {
        questions: { select: { marks: true, type: true } },
        examiner: { select: { name: true, examinerProfile: { select: { orgName: true } } } },
      },
    });
    if (!exam || exam.status !== 'PUBLISHED') {
      await this.audit.log({ action: 'join.miss', ip: ip ?? 'unknown' });
      throw new NotFoundException('Exam code not found');
    }
    const total = exam.questions.reduce((s, q) => s + q.marks, 0);
    return {
      examId: exam.id,
      code: exam.code!,
      title: exam.title,
      description: exam.description,
      trainerName: exam.nandivexHosted ? 'NandiVex Technologies' : exam.examiner.name,
      orgName: exam.nandivexHosted ? null : (exam.examiner.examinerProfile?.orgName ?? null),
      durationMinutes: exam.durationMinutes,
      startsAt: exam.startsAt?.toISOString() ?? null,
      endsAt: exam.endsAt?.toISOString() ?? null,
      questionCount: exam.questions.length,
      totalMarks: Math.round(total * 100) / 100,
      feePaise: studentJoinFee(exam, (await this.settings.get()).examJoinPaise),
      nandivexHosted: exam.nandivexHosted,
      sponsored: pricingMode(exam) === 'TRAINER_SPONSORED',
      alwaysOpen: exam.alwaysOpen,
      hasWrittenQuestions: exam.questions.some((q) => q.type === 'SUBJECTIVE'),
      // Who is asking is not known yet, so "already joined" is answered by myForCode.
      state: computeJoinState({
        startsAt: exam.startsAt,
        endsAt: exam.endsAt,
        alreadyEnrolled: false,
      }),
    };
  }

  /** This student's seat in the exam behind a code, if they have one. */
  async myForCode(user: AuthUser, rawCode: string): Promise<EnrollmentDto | null> {
    const exam = await this.prisma.exam.findUnique({
      where: { code: normalizeCode(rawCode) },
      select: { id: true },
    });
    if (!exam) return null;
    return (await this.mine(user)).find((e) => e.exam.id === exam.id) ?? null;
  }

  async mine(user: AuthUser): Promise<EnrollmentDto[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: { studentId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            durationMinutes: true,
            alwaysOpen: true,
          },
        },
        attempt: {
          select: {
            id: true,
            status: true,
            deadlineAt: true,
            score: true,
            maxScore: true,
            percent: true,
            passed: true,
            resultEmailedAt: true,
          },
        },
      },
    });
    const now = new Date();
    return rows.map((r) => {
      const open =
        r.exam.alwaysOpen ||
        ((!r.exam.startsAt || r.exam.startsAt <= now) && (!r.exam.endsAt || r.exam.endsAt > now));
      const attemptDone = r.attempt && r.attempt.status !== 'IN_PROGRESS';
      const running = r.attempt && r.attempt.status === 'IN_PROGRESS' && r.attempt.deadlineAt > now;
      return {
        enrollmentId: r.id,
        exam: {
          id: r.exam.id,
          title: r.exam.title,
          startsAt: r.exam.startsAt?.toISOString() ?? null,
          endsAt: r.exam.endsAt?.toISOString() ?? null,
          durationMinutes: r.exam.durationMinutes,
        },
        attempt: r.attempt
          ? {
              id: r.attempt.id,
              status: r.attempt.status,
              deadlineAt: r.attempt.deadlineAt.toISOString(),
            }
          : null,
        result:
          r.attempt?.status === 'RESULT_PUBLISHED' && r.attempt.score !== null
            ? {
                score: r.attempt.score,
                maxScore: r.attempt.maxScore ?? 0,
                percent: r.attempt.percent ?? 0,
                passed: Boolean(r.attempt.passed),
              }
            : null,
        canStart: !attemptDone && (Boolean(running) || open),
        canRetake:
          r.supersededAt === null &&
          canRetake({ exam: { alwaysOpen: r.exam.alwaysOpen }, attempt: r.attempt }),
      };
    });
  }
}
