import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Certificate, Prisma } from '@prisma/client';
import { createHmac, randomInt } from 'node:crypto';
import {
  DEFAULT_CERT_TEMPLATE,
  SERIAL_PATTERN,
  certificateKind,
  certificateTemplateSchema,
  type CertKind,
  type CertQueueExamDto,
  type CertQueueRowDto,
  type CertStatus,
  type CertificateTemplate,
  type MyCertificateDto,
  type TrainerCertificatesDto,
  type VerifyCertificateDto,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { ENV, Env } from '../config/env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE, Storage } from '../storage/storage.service';
import { renderCertificate } from './render';

const UUID = /^[0-9a-f-]{36}$/i;
// No I, O, 0 or 1: serials are read out loud and typed by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_EMAIL_ATTEMPTS = 5;
/** A failed PDF is retried this many times, waiting 1, 2, 4... minutes, then left for an admin. */
export const MAX_PDF_ATTEMPTS = 3;
const EMAIL_LOCK_MS = 10 * 60_000;

/** A short serial that is easy to read out and type, like PRK-7K3P-9QX2 (about 10^12 of them). */
export function generateSerial(): string {
  const block = () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `PRK-${block()}-${block()}`;
}

/** Reads the template stored on an exam; anything missing or damaged falls back to the defaults. */
export function templateOf(json: unknown): CertificateTemplate {
  const parsed = certificateTemplateSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : DEFAULT_CERT_TEMPLATE;
}

@Injectable()
export class CertificatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CertificatesService.name);
  private readonly secret: string;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(STORAGE) private readonly storage: Storage,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.secret = env.DATA_ENCRYPTION_KEY ?? env.OTP_SECRET;
  }

  // ------------------------------------------------------------- background

  onModuleInit() {
    if (this.env.CERT_JOBS_POLL !== 'on') return;
    this.timer = setInterval(() => void this.runOnce(), 5000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs soon, without waiting for the next tick. */
  kick() {
    if (this.env.CERT_JOBS_POLL === 'on') setImmediate(() => void this.runOnce());
  }

  /** One pass: make missing PDFs, then email approved certificates. Safe to run from many servers. */
  async runOnce(): Promise<{ generated: number; emailed: number }> {
    if (this.running) return { generated: 0, emailed: 0 };
    this.running = true;
    try {
      return { generated: await this.generatePending(), emailed: await this.emailApproved() };
    } catch (err) {
      this.logger.error('Certificate job failed', err as Error);
      return { generated: 0, emailed: 0 };
    } finally {
      this.running = false;
    }
  }

  private async generatePending(): Promise<number> {
    const rows = await this.prisma.certificate.findMany({
      where: {
        pdfKey: null,
        OR: [
          { pdfError: null },
          { pdfAttempts: { lt: MAX_PDF_ATTEMPTS }, pdfNextAt: { lte: new Date() } },
        ],
      },
      take: 25,
      orderBy: { createdAt: 'asc' },
    });
    let done = 0;
    for (const c of rows) if (await this.ensurePdf(c)) done++;
    return done;
  }

  private async emailApproved(): Promise<number> {
    const now = new Date();
    const rows = await this.prisma.certificate.findMany({
      where: {
        status: 'APPROVED',
        emailAttempts: { lt: MAX_EMAIL_ATTEMPTS },
        OR: [{ emailNextAt: null }, { emailNextAt: { lte: now } }],
      },
      take: 10,
      orderBy: { approvedAt: 'asc' },
      include: { student: { select: { email: true, name: true } } },
    });
    let sent = 0;
    for (const c of rows) {
      // Claim it for a while so two servers never email the same certificate.
      const claimed = await this.prisma.certificate.updateMany({
        where: {
          id: c.id,
          status: 'APPROVED',
          OR: [{ emailNextAt: null }, { emailNextAt: { lte: now } }],
        },
        data: { emailNextAt: new Date(now.getTime() + EMAIL_LOCK_MS) },
      });
      if (claimed.count === 0) continue;
      try {
        const pdf = await this.pdfBytes(c);
        const messageId = await this.mail.sendCertificate(c.student.email, c.student.name, {
          examTitle: c.examTitle,
          serialNo: c.serialNo,
          verifyUrl: this.verifyUrl(c.serialNo),
          pdf,
        });
        await this.prisma.certificate.updateMany({
          where: { id: c.id, status: 'APPROVED' },
          data: {
            status: 'EMAILED',
            emailedAt: new Date(),
            emailNextAt: null,
            emailError: null,
            emailMessageId: messageId ?? null,
          },
        });
        sent++;
      } catch (err) {
        const attempts = c.emailAttempts + 1;
        await this.prisma.certificate.update({
          where: { id: c.id },
          data: {
            emailAttempts: attempts,
            emailError: String((err as Error).message ?? err).slice(0, 300),
            emailNextAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
          },
        });
        this.logger.warn(`Emailing certificate ${c.serialNo} failed (try ${attempts})`);
      }
    }
    return sent;
  }

  // --------------------------------------------------------------- helpers

  private webBase() {
    return (this.env.VERIFY_BASE_URL ?? this.env.WEB_ORIGIN.split(',')[0])
      .trim()
      .replace(/\/+$/, '');
  }

  verifyUrl(serialNo: string) {
    return `${this.webBase()}/verify/?serial=${serialNo}`;
  }

  private hash(c: {
    serialNo: string;
    holderName: string;
    examTitle: string;
    kind: string;
    scorePercent: number;
    participants?: number | null;
    issuedOn: Date;
  }): string {
    return createHmac('sha256', this.secret)
      .update(
        [
          c.serialNo,
          c.holderName,
          c.examTitle,
          c.kind,
          c.scorePercent,
          c.participants ?? '',
          c.issuedOn.toISOString(),
        ].join('|'),
      )
      .digest('hex');
  }

  private async trainerLogo(exam: { logoKey: string | null; examinerId: string }) {
    let key = exam.logoKey;
    if (!key) {
      key =
        (await this.prisma.examinerProfile.findUnique({ where: { userId: exam.examinerId } }))
          ?.logoKey ?? null;
    }
    return key ? ((await this.storage.get(key))?.body ?? null) : null;
  }

  /** Makes (once) and stores the PDF for a certificate. Returns false when it cannot be made. */
  private async ensurePdf(c: Certificate): Promise<boolean> {
    if (c.pdfKey) return true;
    try {
      const exam = await this.prisma.exam.findUniqueOrThrow({ where: { id: c.examId } });
      const pdf = await renderCertificate({
        facts: {
          holderName: c.holderName,
          examTitle: c.examTitle,
          orgName: c.orgName,
          kind: c.kind,
          scorePercent: c.scorePercent,
          participants: c.participants,
          issuedOn: c.issuedOn,
          serialNo: c.serialNo,
          verifyUrl: this.verifyUrl(c.serialNo),
        },
        trainerLogo: await this.trainerLogo(exam),
        nandivexOnly: exam.nandivexHosted,
      });
      const key = `certificates/${c.examId}/${c.serialNo}.pdf`;
      await this.storage.put(key, pdf, 'application/pdf');
      await this.prisma.certificate.update({
        where: { id: c.id },
        data: { pdfKey: key, pdfError: null, pdfAttempts: 0, pdfNextAt: null },
      });
      c.pdfKey = key;
      return true;
    } catch (err) {
      this.logger.error(`Could not make the PDF for ${c.serialNo}`, err as Error);
      const attempts = c.pdfAttempts + 1;
      c.pdfAttempts = attempts;
      await this.prisma.certificate.update({
        where: { id: c.id },
        data: {
          pdfError: String((err as Error).message ?? err).slice(0, 300),
          pdfAttempts: attempts,
          pdfNextAt: new Date(Date.now() + 2 ** (attempts - 1) * 60_000),
        },
      });
      return false;
    }
  }

  private async pdfBytes(c: Certificate): Promise<Buffer> {
    if (!c.pdfKey) {
      // Give a failed render another go when someone actually needs the file.
      await this.prisma.certificate.update({ where: { id: c.id }, data: { pdfError: null } });
      if (!(await this.ensurePdf(c))) throw new Error('The certificate PDF could not be made');
    }
    const file = await this.storage.get(c.pdfKey!);
    if (!file) {
      await this.prisma.certificate.update({ where: { id: c.id }, data: { pdfKey: null } });
      c.pdfKey = null;
      if (!(await this.ensurePdf(c))) throw new Error('The certificate PDF could not be made');
      return (await this.storage.get(c.pdfKey!))!.body;
    }
    return file.body;
  }

  // ----------------------------------------- one student, sent with the results email

  /**
   * Makes (or finds) this student's certificate and returns its PDF to attach to the results
   * email. Returns null when the exam gives no certificate to this student: certificates are off,
   * the student is below the pass mark and participation certificates are off, or it was revoked.
   */
  async forResultsEmail(attemptId: string): Promise<{
    id: string;
    kind: CertKind;
    serialNo: string;
    verifyUrl: string;
    pdf: Buffer;
  } | null> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        student: { select: { name: true } },
        exam: {
          include: {
            examiner: { select: { name: true, examinerProfile: { select: { orgName: true } } } },
          },
        },
      },
    });
    if (!attempt || attempt.percent === null) return null;
    const { exam } = attempt;
    const template = templateOf(exam.certificate);
    if (!template.enabled) return null;
    const kind = certificateKind(attempt.percent, exam.passPercent);
    if (kind === 'PARTICIPATION' && !template.participation) return null;

    let cert = await this.prisma.certificate.findUnique({ where: { attemptId } });
    if (cert?.status === 'REJECTED') return null;
    if (!cert) {
      const row = {
        serialNo: generateSerial(),
        holderName: attempt.student.name,
        examTitle: exam.title,
        kind,
        scorePercent: Math.round(attempt.percent * 10) / 10,
        issuedOn: exam.resultsPublishedAt ?? new Date(),
      };
      cert = await this.prisma.certificate.create({
        data: {
          ...row,
          attemptId,
          examId: exam.id,
          studentId: attempt.studentId,
          orgName: exam.nandivexHosted
            ? null
            : (exam.examiner.examinerProfile?.orgName ?? exam.examiner.name),
          verifyHash: this.hash(row),
          status: 'APPROVED',
          approvedAt: new Date(),
        },
      });
    }
    return {
      id: cert.id,
      kind: cert.kind,
      serialNo: cert.serialNo,
      verifyUrl: this.verifyUrl(cert.serialNo),
      pdf: await this.pdfBytes(cert),
    };
  }

  /** The certificate went out inside the results email. */
  async markEmailed(certificateId: string): Promise<void> {
    await this.prisma.certificate.updateMany({
      where: { id: certificateId, status: { in: ['APPROVED', 'GENERATED'] } },
      data: { status: 'EMAILED', emailedAt: new Date(), emailNextAt: null, emailError: null },
    });
  }

  // ---------------------------------------------------- creation (on results)

  /** After results are published: one certificate per eligible student, released and emailed at once. */
  async createForExam(examId: string): Promise<number> {
    const exam = await this.prisma.exam.findUnique({
      where: { id: examId },
      include: {
        examiner: { select: { name: true, examinerProfile: { select: { orgName: true } } } },
      },
    });
    if (!exam) return 0;
    const template = templateOf(exam.certificate);
    if (!template.enabled) return 0;

    const attempts = await this.prisma.attempt.findMany({
      where: { examId, status: 'RESULT_PUBLISHED', percent: { not: null } },
      include: { student: { select: { name: true } } },
    });
    const issuedOn = exam.resultsPublishedAt ?? new Date();
    const orgName = exam.examiner.examinerProfile?.orgName ?? exam.examiner.name;
    // No admin approval step: certificates are released the moment results are published, and the
    // background job emails them. An admin can still reject (revoke) one afterwards.
    const released = { status: 'APPROVED' as const, approvedAt: new Date() };
    const data: Prisma.CertificateCreateManyInput[] = [];
    for (const a of attempts) {
      const percent = a.percent ?? 0;
      const kind = certificateKind(percent, exam.passPercent);
      if (kind === 'PARTICIPATION' && !template.participation) continue;
      const row = {
        serialNo: generateSerial(),
        holderName: a.student.name,
        examTitle: exam.title,
        kind,
        scorePercent: Math.round(percent * 10) / 10,
        issuedOn,
      };
      data.push({
        ...row,
        attemptId: a.id,
        examId,
        studentId: a.studentId,
        orgName,
        verifyHash: this.hash(row),
        ...released,
      });
    }
    // The trainer's own certificate for conducting the exam: one per exam, once students sat it.
    if (template.trainerCertificate && !exam.nandivexHosted && attempts.length > 0) {
      const exists = await this.prisma.certificate.findFirst({
        where: { examId, kind: 'TRAINER' },
        select: { id: true },
      });
      if (!exists) {
        const row = {
          serialNo: generateSerial(),
          holderName: exam.examiner.name,
          examTitle: exam.title,
          kind: 'TRAINER' as const,
          scorePercent: 0,
          participants: attempts.length,
          issuedOn,
        };
        data.push({
          ...row,
          attemptId: null,
          examId,
          studentId: exam.examinerId,
          orgName,
          verifyHash: this.hash(row),
          ...released,
        });
      }
    }
    const created = data.length
      ? (await this.prisma.certificate.createMany({ data, skipDuplicates: true })).count
      : 0;
    if (created > 0) this.kick();
    return created;
  }

  // ------------------------------------------------------------- trainer

  private async ownedExam(user: AuthUser, examId: string) {
    const exam = UUID.test(examId)
      ? await this.prisma.exam.findFirst({ where: { id: examId, examinerId: user.id } })
      : null;
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  async trainerView(user: AuthUser, examId: string): Promise<TrainerCertificatesDto> {
    const exam = await this.ownedExam(user, examId);
    const groups = await this.prisma.certificate.groupBy({
      by: ['status'],
      where: { examId },
      _count: { _all: true },
    });
    const n = (...s: CertStatus[]) =>
      groups.filter((g) => s.includes(g.status)).reduce((t, g) => t + g._count._all, 0);
    const template = templateOf(exam.certificate);
    return {
      enabled: template.enabled,
      finalized: exam.status === 'RESULTS_FINAL',
      total: n('GENERATED', 'APPROVED', 'REJECTED', 'EMAILED'),
      waiting: n('GENERATED'),
      issued: n('APPROVED', 'EMAILED'),
      rejected: n('REJECTED'),
      template,
    };
  }

  async saveTemplate(
    user: AuthUser,
    examId: string,
    template: CertificateTemplate,
  ): Promise<TrainerCertificatesDto> {
    const exam = await this.ownedExam(user, examId);
    if (exam.status !== 'DRAFT') {
      throw new ConflictException(
        'This exam is published, so the certificate can no longer change',
      );
    }
    await this.prisma.exam.update({
      where: { id: exam.id },
      data: { certificate: template as unknown as Prisma.InputJsonValue },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'certificate.template.save',
      entity: 'Exam',
      entityId: exam.id,
    });
    return this.trainerView(user, examId);
  }

  /** A sample certificate with the template as it is now (not saved yet). */
  async preview(
    user: AuthUser,
    examId: string,
    template: CertificateTemplate,
    kind: CertKind,
  ): Promise<Buffer> {
    const exam = await this.ownedExam(user, examId);
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { examinerProfile: { select: { orgName: true } } },
    });
    return renderCertificate({
      facts: {
        holderName: kind === 'TRAINER' ? owner.name : 'Student Name',
        examTitle: exam.title,
        orgName: owner.examinerProfile?.orgName ?? owner.name,
        kind,
        scorePercent:
          kind === 'PARTICIPATION' ? exam.passPercent / 2 : Math.max(exam.passPercent, 85),
        participants: kind === 'TRAINER' ? 120 : null,
        issuedOn: new Date(),
        serialNo: 'PRK-SMPL-0000',
        verifyUrl: this.verifyUrl('PRK-SMPL-0000'),
        sample: true,
      },
      trainerLogo: await this.trainerLogo(exam),
      nandivexOnly: exam.nandivexHosted,
    });
  }

  /**
   * Sample PDFs for the student invite email: what a pass earns and, when enabled, what a fail earns.
   * Returns null when this exam gives no certificates, so the email never mentions them.
   */
  async inviteSamples(examId: string): Promise<{ passed: Buffer; participation?: Buffer } | null> {
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) return null;
    const template = templateOf(exam.certificate);
    if (!template.enabled) return null;
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: exam.examinerId },
      include: { examinerProfile: { select: { orgName: true } } },
    });
    const logo = await this.trainerLogo(exam);
    const make = (kind: CertKind) =>
      renderCertificate({
        facts: {
          holderName: 'Student Name',
          examTitle: exam.title,
          orgName: owner.examinerProfile?.orgName ?? owner.name,
          kind,
          scorePercent:
            kind === 'PARTICIPATION' ? exam.passPercent / 2 : Math.max(exam.passPercent, 85),
          participants: null,
          issuedOn: new Date(),
          serialNo: 'PRK-SMPL-0000',
          verifyUrl: this.verifyUrl('PRK-SMPL-0000'),
          sample: true,
        },
        trainerLogo: logo,
        nandivexOnly: exam.nandivexHosted,
      });
    return {
      passed: await make('ACHIEVEMENT'),
      participation: template.participation ? await make('PARTICIPATION') : undefined,
    };
  }

  // ------------------------------------------------------------- student

  async mine(user: AuthUser): Promise<MyCertificateDto[]> {
    const rows = await this.prisma.certificate.findMany({
      where: { studentId: user.id, status: { not: 'REJECTED' } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c) => ({
      id: c.id,
      serialNo: c.serialNo,
      examTitle: c.examTitle,
      kind: c.kind,
      state: c.status === 'GENERATED' ? 'PENDING' : 'ISSUED',
      issuedOn: c.issuedOn.toISOString(),
      verifyUrl: this.verifyUrl(c.serialNo),
    }));
  }

  /** Only the student's own certificate, and only once NandiVex has approved it. */
  async studentPdf(user: AuthUser, id: string): Promise<{ filename: string; body: Buffer }> {
    const c = UUID.test(id)
      ? await this.prisma.certificate.findFirst({
          where: { id, studentId: user.id, status: { in: ['APPROVED', 'EMAILED'] } },
        })
      : null;
    if (!c) throw new NotFoundException('Certificate not found');
    return { filename: `certificate-${c.serialNo}.pdf`, body: await this.pdfBytes(c) };
  }

  // --------------------------------------------------------------- admin

  async queue(status: CertStatus = 'GENERATED', examId?: string) {
    const groups = await this.prisma.certificate.groupBy({
      by: ['examId', 'status'],
      _count: { _all: true },
    });
    const examIds = [...new Set(groups.map((g) => g.examId))];
    const exams = await this.prisma.exam.findMany({
      where: { id: { in: examIds } },
      select: { id: true, title: true, examiner: { select: { name: true } } },
    });
    const count = (id: string, ...s: CertStatus[]) =>
      groups
        .filter((g) => g.examId === id && s.includes(g.status))
        .reduce((t, g) => t + g._count._all, 0);
    const summary: CertQueueExamDto[] = exams
      .map((e) => ({
        examId: e.id,
        examTitle: e.title,
        trainerName: e.examiner.name,
        waiting: count(e.id, 'GENERATED'),
        approved: count(e.id, 'APPROVED', 'EMAILED'),
        rejected: count(e.id, 'REJECTED'),
      }))
      .sort((a, b) => b.waiting - a.waiting);

    const rows = await this.prisma.certificate.findMany({
      where: { status, ...(examId && UUID.test(examId) ? { examId } : {}) },
      orderBy: [{ examId: 'asc' }, { holderName: 'asc' }],
      take: 500,
      include: { student: { select: { email: true } } },
    });
    const dto: CertQueueRowDto[] = rows.map((c) => ({
      id: c.id,
      serialNo: c.serialNo,
      examId: c.examId,
      examTitle: c.examTitle,
      holderName: c.holderName,
      holderEmail: c.student.email,
      kind: c.kind,
      scorePercent: c.scorePercent,
      participants: c.participants,
      status: c.status,
      pdfReady: Boolean(c.pdfKey),
      pdfError: c.pdfKey ? null : c.pdfError,
      rejectReason: c.rejectReason,
      emailedAt: c.emailedAt?.toISOString() ?? null,
      emailError: c.emailError,
      emailBounced: Boolean(c.emailBouncedAt),
    }));
    return { exams: summary, rows: dto };
  }

  async adminPdf(id: string): Promise<{ filename: string; body: Buffer }> {
    const c = UUID.test(id) ? await this.prisma.certificate.findUnique({ where: { id } }) : null;
    if (!c) throw new NotFoundException('Certificate not found');
    return { filename: `certificate-${c.serialNo}.pdf`, body: await this.pdfBytes(c) };
  }

  /** Releases certificates: they are emailed to the students in the background. */
  async approve(
    admin: AuthUser,
    input: { ids?: string[]; examId?: string },
  ): Promise<{ approved: number }> {
    const result = await this.prisma.certificate.updateMany({
      // Approving a whole exam never brings back certificates an admin rejected; choosing them
      // one by one does.
      where: input.ids
        ? { id: { in: input.ids }, status: { in: ['GENERATED', 'REJECTED'] } }
        : { examId: input.examId, status: 'GENERATED' },
      data: {
        status: 'APPROVED',
        approvedById: admin.id,
        approvedAt: new Date(),
        rejectedAt: null,
        rejectReason: null,
        emailAttempts: 0,
        emailNextAt: null,
        emailError: null,
      },
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'certificate.approve',
      entity: input.examId ? 'Exam' : 'Certificate',
      entityId: input.examId ?? input.ids?.[0],
      meta: { count: result.count },
    });
    if (result.count > 0) this.kick();
    return { approved: result.count };
  }

  /** Rejects certificates, or revokes ones already issued. The student is not told by email. */
  async reject(admin: AuthUser, ids: string[], reason: string): Promise<{ rejected: number }> {
    const result = await this.prisma.certificate.updateMany({
      where: { id: { in: ids }, status: { not: 'REJECTED' } },
      data: { status: 'REJECTED', rejectedAt: new Date(), rejectReason: reason },
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'certificate.reject',
      entity: 'Certificate',
      entityId: ids[0],
      meta: { count: result.count, reason },
    });
    return { rejected: result.count };
  }

  /** Sends an issued certificate again (for example after the student fixed a mailbox problem). */
  /** Admin: try making the PDF again after the automatic retries gave up. */
  async regenerate(admin: AuthUser, id: string): Promise<{ queued: true }> {
    const c = UUID.test(id) ? await this.prisma.certificate.findUnique({ where: { id } }) : null;
    if (!c) throw new NotFoundException('Certificate not found');
    if (c.pdfKey) throw new ConflictException('This certificate already has its PDF');
    await this.prisma.certificate.update({
      where: { id },
      data: { pdfError: null, pdfAttempts: 0, pdfNextAt: null },
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'certificate.regenerate',
      entity: 'Certificate',
      entityId: id,
    });
    this.kick();
    return { queued: true };
  }

  async resend(admin: AuthUser, id: string): Promise<{ queued: true }> {
    const c = UUID.test(id) ? await this.prisma.certificate.findUnique({ where: { id } }) : null;
    if (!c) throw new NotFoundException('Certificate not found');
    if (c.status !== 'APPROVED' && c.status !== 'EMAILED') {
      throw new ConflictException('Only an approved certificate can be sent');
    }
    await this.prisma.certificate.update({
      where: { id },
      data: {
        status: 'APPROVED',
        emailAttempts: 0,
        emailNextAt: null,
        emailError: null,
        emailBouncedAt: null,
      },
    });
    await this.audit.log({
      actorId: admin.id,
      action: 'certificate.resend',
      entity: 'Certificate',
      entityId: id,
    });
    this.kick();
    return { queued: true };
  }

  // -------------------------------------------------------------- public

  async verify(rawSerial: string): Promise<VerifyCertificateDto> {
    const serialNo = rawSerial.trim().toUpperCase();
    const notFound: VerifyCertificateDto = { state: 'NOT_FOUND', serialNo };
    if (!SERIAL_PATTERN.test(serialNo)) return notFound;
    const c = await this.prisma.certificate.findUnique({ where: { serialNo } });
    if (!c || !c.approvedAt) return notFound;
    if (c.verifyHash !== this.hash(c)) {
      // The printed facts no longer match what was signed when it was issued.
      this.logger.error(`Certificate ${serialNo} failed its integrity check`);
      return notFound;
    }
    const info = {
      serialNo,
      holderName: c.holderName,
      examTitle: c.examTitle,
      organisation: c.orgName,
      kind: c.kind,
      issuedOn: c.issuedOn.toISOString(),
    };
    return c.status === 'REJECTED' ? { state: 'REVOKED', ...info } : { state: 'VALID', ...info };
  }

  // ------------------------------------------------------- bounce handling

  /** A mail provider notice (through SNS) about an email we sent. */
  async recordMailEvent(e: {
    snsId: string;
    kind: 'BOUNCE' | 'COMPLAINT' | 'DELIVERY';
    messageId: string;
    recipient?: string;
    detail?: string;
  }): Promise<void> {
    try {
      await this.prisma.emailEvent.create({ data: e });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return; // seen
      throw err;
    }
    if (e.kind === 'DELIVERY') return;
    await this.prisma.certificate.updateMany({
      where: { emailMessageId: e.messageId },
      data: {
        emailBouncedAt: new Date(),
        emailError:
          `${e.kind === 'BOUNCE' ? 'Bounced' : 'Complaint'}${e.detail ? `: ${e.detail}` : ''}`.slice(
            0,
            300,
          ),
      },
    });
  }
}
