import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatReceiptNo } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import type { AuthUser } from '../common/decorators';
import type { RequestMeta } from '../common/request-meta';
import { LedgerService } from '../ledger/ledger.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

/** The user's data rights (DPDP): see everything we hold, and have their identity removed. */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  // ------------------------------------------------------------------- download

  /** Plain data only: never password hashes, codes, tokens or the encrypted account number. */
  async exportData(user: AuthUser) {
    const me = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { examinerProfile: true },
    });
    if (!me) throw new NotFoundException('Account not found');

    const [enrollments, attempts, payments, payouts, certificates, practice, exams] =
      await Promise.all([
        this.prisma.enrollment.findMany({
          where: { studentId: user.id },
          include: { exam: { select: { title: true, code: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.attempt.findMany({
          where: { studentId: user.id },
          include: {
            exam: { select: { title: true } },
            answers: {
              select: {
                questionId: true,
                selected: true,
                text: true,
                flagged: true,
                marksAwarded: true,
                marksOverride: true,
                feedback: true,
                updatedAt: true,
              },
            },
            events: {
              select: { type: true, strike: true, ip: true, deviceId: true, createdAt: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { startedAt: 'asc' },
        }),
        this.prisma.payment.findMany({
          where: { userId: user.id },
          include: { exam: { select: { title: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.payout.findMany({
          where: { examinerId: user.id },
          orderBy: { requestedAt: 'asc' },
        }),
        this.prisma.certificate.findMany({ where: { studentId: user.id } }),
        this.prisma.practiceRound.findMany({
          where: { studentId: user.id },
          include: { exam: { select: { title: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.exam.findMany({
          where: { examinerId: user.id },
          include: { questions: { orderBy: { position: 'asc' } } },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    // Answers say which question they belong to; add the question text so the file is readable.
    const questionIds = [...new Set(attempts.flatMap((a) => a.answers.map((x) => x.questionId)))];
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, body: true },
    });
    const questionText = new Map(questions.map((q) => [q.id, q.body]));

    const profile = me.examinerProfile;
    return {
      exportedAt: new Date().toISOString(),
      note: 'Everything Parakh holds about this account. Passwords, codes and sign-in tokens are never included.',
      account: {
        name: me.name,
        email: me.email,
        phone: me.phone,
        role: me.role,
        createdAt: me.createdAt,
        emailVerifiedAt: me.emailVerifiedAt,
        termsAcceptedAt: me.termsAcceptedAt,
        termsVersion: me.termsVersion,
      },
      trainerProfile: profile
        ? {
            organisation: profile.orgName,
            payoutMethod: profile.payoutMethod,
            upiId: profile.upiId,
            bankAccountName: profile.bankAccountName,
            bankAccountEnding: profile.bankAccountLast4,
            ifsc: profile.ifsc,
            payoutDetailsVerifiedAt: profile.payoutDetailsVerifiedAt,
          }
        : null,
      enrollments: enrollments.map((e) => ({
        exam: e.exam.title,
        code: e.exam.code,
        extraMinutes: e.extraMinutes,
        joinedAt: e.createdAt,
      })),
      attempts: attempts.map((a) => ({
        exam: a.exam.title,
        status: a.status,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        endReason: a.endReason,
        strikes: a.strikes,
        score: a.score,
        maxScore: a.maxScore,
        percent: a.percent,
        passed: a.passed,
        startIp: a.startIp,
        lastIp: a.lastIp,
        userAgent: a.userAgent,
        answers: a.answers.map((x) => ({
          question: questionText.get(x.questionId) ?? null,
          selectedOptions: x.selected,
          text: x.text,
          flagged: x.flagged,
          marksAwarded: x.marksOverride ?? x.marksAwarded,
          feedback: x.feedback,
          savedAt: x.updatedAt,
        })),
        proctoringEvents: a.events,
      })),
      payments: payments.map((p) => ({
        receiptNo: formatReceiptNo(p.receiptNo),
        purpose: p.purpose,
        exam: p.exam?.title ?? null,
        amountPaise: p.amountPaise,
        status: p.status,
        paidAt: p.capturedAt,
        refundedAt: p.refundedAt,
        refundReason: p.refundReason,
      })),
      payouts: payouts.map((p) => ({
        amountPaise: p.amountPaise,
        status: p.status,
        destination: p.destination,
        utr: p.utr,
        requestedAt: p.requestedAt,
        paidAt: p.paidAt,
      })),
      certificates: certificates.map((c) => ({
        serialNo: c.serialNo,
        kind: c.kind,
        status: c.status,
        holderName: c.holderName,
        exam: c.examTitle,
        scorePercent: c.scorePercent,
        issuedOn: c.issuedOn,
      })),
      practiceRounds: practice.map((r) => ({
        exam: r.exam.title,
        score: r.score,
        maxScore: r.maxScore,
        percent: r.percent,
        takenAt: r.createdAt,
      })),
      examsYouCreated: exams.map((e) => ({
        title: e.title,
        status: e.status,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        // The brief typed for the AI Paper Builder (topics, source text). Never the AI's answer.
        aiBrief: e.aiBrief,
        paperPlan: e.paperPlan,
        questions: e.questions.map((q) => ({
          type: q.type,
          body: q.body,
          options: q.options,
          correctOptions: q.correctOptions,
          marks: q.marks,
        })),
      })),
    };
  }

  // --------------------------------------------------------------------- delete

  /**
   * Wipes who the user is. Payments, the ledger and issued certificates stay, because the law
   * requires financial records and a certificate must stay verifiable. Refused while it would
   * leave something half-done: an exam being taken, live exams, or money still owed.
   */
  async deleteAccount(
    user: AuthUser,
    password: string | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    const me = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!me || me.deletedAt) throw new NotFoundException('Account not found');
    if (me.role === 'ADMIN') {
      throw new ForbiddenException('Admin accounts are closed by NandiVex Technologies support');
    }
    // 403, not 401: a 401 would make the app try to refresh the session instead of showing this.
    if (me.role !== 'STUDENT' && !(await this.passwords.verify(me.passwordHash, password ?? ''))) {
      throw new ForbiddenException('That password is not correct');
    }
    await this.assertNothingOpen(me.id, me.role);

    const anonEmail = `deleted-${me.id}@deleted.invalid`;
    // A random password nobody knows, so the account cannot be signed into again.
    const lockedHash = await this.passwords.hash(randomBytes(32).toString('hex'));
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: me.id },
        data: {
          name: 'Deleted user',
          email: anonEmail,
          phone: null,
          passwordHash: lockedHash,
          status: 'SUSPENDED',
          deletedAt: now,
        },
      });
      await tx.refreshToken.deleteMany({ where: { userId: me.id } });
      await tx.emailOtp.deleteMany({ where: { userId: me.id } });
      await tx.loginFailure.deleteMany({ where: { email: me.email } });
      // Organisation, logo and payout details go; payout history keeps its masked snapshot.
      await tx.examinerProfile.deleteMany({ where: { userId: me.id } });
      // Seats reserved for this email stay locked to nobody rather than opening up to anyone.
      await tx.seat.updateMany({ where: { email: me.email }, data: { email: anonEmail } });
      // Network and device traces from exams are personal data; the answers and scores stay.
      await tx.attempt.updateMany({
        where: { studentId: me.id },
        data: { startIp: null, lastIp: null, userAgent: null, deviceId: null },
      });
      await tx.proctorEvent.updateMany({
        where: { attempt: { studentId: me.id } },
        data: { ip: null, deviceId: null },
      });
    });

    // The audit entry holds only the id, never the old name or email.
    await this.audit.log({
      actorId: me.id,
      action: 'account.delete',
      entity: 'User',
      entityId: me.id,
      meta: { role: me.role },
      ip: meta.ip,
    });
    await this.mail.sendAccountDeleted(me.email, me.name);
  }

  private async assertNothingOpen(userId: string, role: 'STUDENT' | 'EXAMINER' | 'ADMIN') {
    if (role === 'STUDENT') {
      const running = await this.prisma.attempt.count({
        where: { studentId: userId, status: 'IN_PROGRESS' },
      });
      if (running > 0) {
        throw new ConflictException(
          'Finish or submit the exam you are taking before closing your account',
        );
      }
      return;
    }
    const now = new Date();
    const open = await this.prisma.exam.count({
      where: {
        examinerId: userId,
        status: 'PUBLISHED',
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
    });
    if (open > 0) {
      throw new ConflictException(
        'You have exams that are open or upcoming. Close or cancel them before closing your account',
      );
    }
    const b = await this.ledger.balances(userId);
    if (b.accruedPaise !== 0 || b.netPaise !== 0 || b.pendingPaise !== 0) {
      throw new ConflictException(
        'You still have earnings that have not been paid out. Request your payout and wait until it is paid, then close your account',
      );
    }
  }
}
