import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Attempt, Prisma, Question } from '@prisma/client';
import { randomInt } from 'node:crypto';
import {
  DEVICE_SILENT_MS,
  STRIKE_EVENTS,
  type AttemptDto,
  type AttemptTimingDto,
  type ProctorEventInput,
  type SaveAnswerInput,
} from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser, ClientInfo } from '../common/decorators';
import { GRACE_MS } from '../common/timing';
import { PrismaService } from '../prisma/prisma.service';
import { GradingService } from '../results/grading.service';
import { ResultsDeliveryService } from '../results/results-delivery.service';
import { readPrivateImage } from '../storage/private-image';
import { STORAGE, Storage } from '../storage/storage.service';

/** Blur and tab-hidden usually fire together; events this close count as one strike. */
const STRIKE_DEBOUNCE_MS = 2000;

const UUID = /^[0-9a-f-]{36}$/i;

function shuffled<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

@Injectable()
export class AttemptsService {
  private readonly logger = new Logger(AttemptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly grading: GradingService,
    private readonly delivery: ResultsDeliveryService,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  // ------------------------------------------------------------------ start

  /** Starts the student's attempt, or returns the one already running. */
  async start(user: AuthUser, enrollmentId: string, client: ClientInfo): Promise<AttemptDto> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, studentId: user.id },
      include: {
        attempt: true,
        exam: { include: { questions: { orderBy: { position: 'asc' } } } },
      },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.attempt) return this.view(user, enrollment.attempt.id, client);

    const { exam } = enrollment;
    const now = new Date();
    if (exam.status !== 'PUBLISHED') throw new ConflictException('This exam is not available');
    if (exam.startsAt && exam.startsAt > now)
      throw new ConflictException('This exam has not opened yet');
    // An always-open exam has no window: a retired one still lets students who already paid sit it.
    const windowed = !exam.alwaysOpen;
    if (windowed && exam.endsAt && exam.endsAt <= now) {
      throw new ConflictException('This exam has ended');
    }

    // A student with extra time (accommodation) also gets the window extended by that much.
    const extra = enrollment.extraMinutes * 60_000;
    const byDuration = new Date(now.getTime() + exam.durationMinutes * 60_000 + extra);
    const closing = windowed && exam.endsAt ? new Date(exam.endsAt.getTime() + extra) : null;
    const deadlineAt = closing && closing < byDuration ? closing : byDuration;

    // Every student gets the same paper; only the order may differ.
    const ids = exam.questions.map((q) => q.id);
    const questionOrder = exam.shuffleQuestions ? shuffled(ids) : ids;
    const optionOrders: Record<string, number[]> = {};
    for (const q of exam.questions) {
      if (q.type === 'SINGLE' || q.type === 'MULTI') {
        const idx = q.options.map((_, i) => i);
        optionOrders[q.id] = exam.shuffleOptions ? shuffled(idx) : idx;
      }
    }

    let attemptId: string;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (enrollment.paymentId) {
          // Lock the payment row so a refund cannot be claimed between this check and the insert
          // (the refund claim takes the same row and re-checks for an attempt afterwards).
          await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${enrollment.paymentId}::uuid FOR UPDATE`;
          const payment = await tx.payment.findUnique({
            where: { id: enrollment.paymentId },
            select: { status: true },
          });
          if (payment && (payment.status === 'PENDING_REFUND' || payment.status === 'REFUNDED')) {
            throw new ConflictException(
              'This seat is being refunded, so the exam cannot be started',
            );
          }
        }
        return tx.attempt.create({
          data: {
            enrollmentId: enrollment.id,
            examId: exam.id,
            studentId: user.id,
            startedAt: now,
            deadlineAt,
            questionOrder,
            optionOrders,
            deviceId: client.deviceId,
            startIp: client.ip,
            lastIp: client.ip,
            lastSeenAt: now,
            userAgent: client.userAgent,
          },
        });
      });
      attemptId = created.id;
      await this.audit.log({
        actorId: user.id,
        action: 'attempt.start',
        entity: 'Attempt',
        entityId: created.id,
      });
    } catch (err) {
      // Two tabs starting at once: the second one gets the first one's attempt.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.attempt.findUniqueOrThrow({
          where: { enrollmentId: enrollment.id },
        });
        attemptId = existing.id;
      } else {
        throw err;
      }
    }
    return this.view(user, attemptId, client);
  }

  // ------------------------------------------------------------------- read

  async timing(user: AuthUser, attemptId: string, client: ClientInfo): Promise<AttemptTimingDto> {
    return this.timingDto(await this.load(user, attemptId, client));
  }

  async questionImage(user: AuthUser, attemptId: string, questionId: string, client: ClientInfo) {
    const attempt = await this.load(user, attemptId, client);
    const canReview = attempt.status === 'RESULT_PUBLISHED' && attempt.score !== null;
    if (
      (attempt.status !== 'IN_PROGRESS' && !canReview) ||
      !(attempt.questionOrder as string[]).includes(questionId)
    ) {
      throw new NotFoundException('Image not found');
    }
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, examId: attempt.examId },
      select: { imageKey: true },
    });
    return readPrivateImage(this.storage, question?.imageKey);
  }

  private timingDto(attempt: Attempt): AttemptTimingDto {
    return {
      status: attempt.status,
      endReason: attempt.endReason,
      serverTime: new Date().toISOString(),
      deadlineAt: attempt.deadlineAt.toISOString(),
    };
  }

  async view(user: AuthUser, attemptId: string, client: ClientInfo): Promise<AttemptDto> {
    const attempt = await this.load(user, attemptId, client);
    const exam = await this.prisma.exam.findUniqueOrThrow({
      where: { id: attempt.examId },
      include: {
        questions: true,
        examiner: { select: { name: true, examinerProfile: { select: { orgName: true } } } },
      },
    });
    const student = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true, email: true },
    });
    const live = attempt.status === 'IN_PROGRESS';

    const answers: AttemptDto['answers'] = {};
    let questions: AttemptDto['questions'] = [];
    if (live) {
      const byId = new Map<string, Question>(exam.questions.map((q) => [q.id, q]));
      const order = attempt.questionOrder as string[];
      const optionOrders = attempt.optionOrders as Record<string, number[]>;
      questions = order.flatMap((id, i) => {
        const q = byId.get(id);
        if (!q) return [];
        return [
          {
            id: q.id,
            number: i + 1,
            type: q.type,
            body: q.body,
            markdown: q.markdown,
            imageAlt: q.imageAlt,
            marks: q.marks,
            options: (optionOrders[q.id] ?? []).map((idx) => ({ id: idx, text: q.options[idx] })),
          },
        ];
      });
      const saved = await this.prisma.answer.findMany({ where: { attemptId } });
      for (const a of saved) {
        answers[a.questionId] = {
          selected: a.selected,
          text: a.text ?? '',
          flagged: a.flagged,
        };
      }
    }

    return {
      id: attempt.id,
      ...this.timingDto(attempt),
      strikes: attempt.strikes,
      maxStrikes: exam.maxStrikes,
      strikePolicy: exam.strikePolicy,
      exam: {
        title: exam.title,
        instructions: exam.instructions,
        durationMinutes: exam.durationMinutes,
        code: exam.code,
        trainerName: exam.nandivexHosted ? 'NandiVex Technologies' : exam.examiner.name,
        orgName: exam.nandivexHosted ? null : (exam.examiner.examinerProfile?.orgName ?? null),
        questionCount: exam.questions.length,
        totalMarks: Math.round(exam.questions.reduce((sum, q) => sum + q.marks, 0) * 100) / 100,
        passPercent: exam.passPercent,
        endsAt: exam.endsAt?.toISOString() ?? null,
      },
      student,
      questions,
      answers,
    };
  }

  // --------------------------------------------------------------- autosave

  async saveAnswer(
    user: AuthUser,
    attemptId: string,
    questionId: string,
    input: SaveAnswerInput,
    client: ClientInfo,
  ): Promise<{ saved: true }> {
    const attempt = await this.load(user, attemptId, client);
    this.assertWritable(attempt);

    const order = attempt.questionOrder as string[];
    if (!UUID.test(questionId) || !order.includes(questionId)) {
      throw new NotFoundException('Question not found');
    }
    const question = await this.prisma.question.findUniqueOrThrow({ where: { id: questionId } });

    let selected: number[] | undefined;
    let text: string | undefined;
    if (question.type === 'SUBJECTIVE') {
      text = input.text;
    } else if (input.selected !== undefined) {
      const unique = [...new Set(input.selected)];
      if (unique.some((i) => i >= question.options.length)) {
        throw new ConflictException('That option does not exist');
      }
      if (question.type === 'SINGLE' && unique.length > 1) {
        throw new ConflictException('Only one option can be selected');
      }
      selected = unique.sort((a, b) => a - b);
    }

    const seq = input.seq !== undefined ? BigInt(input.seq) : null;
    const updated = await this.prisma.answer.updateMany({
      where: { attemptId, questionId, ...(seq !== null ? { clientSeq: { lt: seq } } : {}) },
      data: {
        selected,
        text,
        flagged: input.flagged,
        ...(seq !== null ? { clientSeq: seq } : {}),
      },
    });
    if (updated.count === 0) {
      const exists = await this.prisma.answer.findUnique({
        where: { attemptId_questionId: { attemptId, questionId } },
        select: { id: true },
      });
      // A row that exists but did not match is a late, older save: ignore it.
      if (!exists) {
        try {
          await this.prisma.answer.create({
            data: {
              attemptId,
              questionId,
              selected: selected ?? [],
              text: text ?? null,
              flagged: input.flagged ?? false,
              clientSeq: seq ?? 0n,
            },
          });
        } catch (err) {
          // Two first saves raced; the other one won and this one is the older.
          if ((err as { code?: string }).code !== 'P2002') throw err;
        }
      }
    }
    return { saved: true };
  }

  /**
   * Objective-only exams: email the answer key and certificate right away. Runs in the background
   * so the student's submit is not slowed down; a failure is retried by the results sweep.
   */
  private sendResultsNow(attemptId: string): void {
    setImmediate(() => {
      this.delivery.deliverIfObjective(attemptId).catch((err: Error) => {
        this.logger.warn(`Instant results for attempt ${attemptId} failed: ${err.message}`);
      });
    });
  }

  // ----------------------------------------------------------------- submit

  async submit(user: AuthUser, attemptId: string, client: ClientInfo): Promise<AttemptDto> {
    const attempt = await this.load(user, attemptId, client);
    if (attempt.status === 'IN_PROGRESS') {
      this.assertWritable(attempt);
      await this.prisma.attempt.updateMany({
        where: { id: attemptId, status: 'IN_PROGRESS' },
        data: { status: 'SUBMITTED', endReason: 'SUBMITTED_BY_STUDENT', submittedAt: new Date() },
      });
      await this.grading.gradeAttempt(attemptId);
      this.sendResultsNow(attemptId);
      await this.audit.log({
        actorId: user.id,
        action: 'attempt.submit',
        entity: 'Attempt',
        entityId: attemptId,
      });
    }
    return this.view(user, attemptId, client);
  }

  // ---------------------------------------------------------------- proctor

  /**
   * The browser reports what it saw; the server decides what it costs. A student who edits the
   * client cannot lower their strikes, only stop reporting them (which is why this is
   * advisory evidence for the trainer, not proof).
   */
  /** Events queued while the student was offline. Handled in order; stops once the attempt ends. */
  async recordEvents(
    user: AuthUser,
    attemptId: string,
    events: ProctorEventInput[],
    client: ClientInfo,
  ) {
    let result = await this.recordEvent(user, attemptId, events[0], client);
    for (const e of events.slice(1)) {
      if (result.ended) break;
      result = await this.recordEvent(user, attemptId, e, client);
    }
    return result;
  }

  async recordEvent(
    user: AuthUser,
    attemptId: string,
    input: ProctorEventInput,
    client: ClientInfo,
  ) {
    const attempt = await this.load(user, attemptId, client);
    if (attempt.status !== 'IN_PROGRESS') {
      return { strikes: attempt.strikes, ended: true, status: attempt.status };
    }
    const exam = await this.prisma.exam.findUniqueOrThrow({
      where: { id: attempt.examId },
      select: { strikePolicy: true, maxStrikes: true },
    });
    const now = new Date();
    let strike = false;
    // With the policy OFF nothing costs a strike; the event is only logged for the trainer.
    if (exam.strikePolicy !== 'OFF' && STRIKE_EVENTS.includes(input.type)) {
      // One conditional update decides, so two events in the same instant cannot both count.
      const claimed = await this.prisma.attempt.updateMany({
        where: {
          id: attemptId,
          status: 'IN_PROGRESS',
          OR: [
            { lastStrikeAt: null },
            { lastStrikeAt: { lt: new Date(now.getTime() - STRIKE_DEBOUNCE_MS) } },
          ],
        },
        data: { strikes: { increment: 1 }, lastStrikeAt: now },
      });
      strike = claimed.count === 1;
    }
    await this.prisma.proctorEvent.create({
      data: { attemptId, type: input.type, strike, ip: client.ip, deviceId: client.deviceId },
    });

    let strikes = attempt.strikes;
    let status: string = attempt.status;
    if (strike) {
      strikes = (await this.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } })).strikes;
      if (exam.strikePolicy === 'AUTO_SUBMIT' && strikes >= exam.maxStrikes) {
        await this.prisma.attempt.updateMany({
          where: { id: attemptId, status: 'IN_PROGRESS' },
          data: { status: 'AUTO_SUBMITTED', endReason: 'STRIKES', submittedAt: now },
        });
        status = 'AUTO_SUBMITTED';
        await this.grading.gradeAttempt(attemptId);
        this.sendResultsNow(attemptId);
        await this.audit.log({
          actorId: user.id,
          action: 'attempt.strikes.autosubmit',
          entity: 'Attempt',
          entityId: attemptId,
        });
      }
    }
    return { strikes, ended: status !== 'IN_PROGRESS', status };
  }

  // ---------------------------------------------------------------- helpers

  /** Loads the caller's own attempt and applies the time limit if it has run out. */
  private async load(user: AuthUser, attemptId: string, client: ClientInfo): Promise<Attempt> {
    const attempt = UUID.test(attemptId)
      ? await this.prisma.attempt.findFirst({ where: { id: attemptId, studentId: user.id } })
      : null;
    if (!attempt) throw new NotFoundException('Attempt not found');
    const current = await this.settle(attempt);
    await this.guardDevice(current, client);
    return current;
  }

  /**
   * One device per attempt. The first device that talks to a running attempt owns it; another
   * device is refused (and recorded) until the trainer releases the attempt. The same device may
   * reload or open a second tab. Finished attempts can be read from anywhere.
   */
  private async guardDevice(attempt: Attempt, client: ClientInfo): Promise<void> {
    if (attempt.status !== 'IN_PROGRESS') return;
    if (attempt.deviceId && client.deviceId && client.deviceId !== attempt.deviceId) {
      const silentFor = attempt.lastSeenAt ? Date.now() - attempt.lastSeenAt.getTime() : 0;
      if (silentFor > DEVICE_SILENT_MS) {
        // The old device has gone quiet (crash, cleared storage, new phone): hand the attempt over
        // and leave a trace for the trainer.
        const moved = await this.prisma.attempt.updateMany({
          where: { id: attempt.id, deviceId: attempt.deviceId, status: 'IN_PROGRESS' },
          data: { deviceId: client.deviceId, lastSeenAt: new Date(), lastIp: client.ip },
        });
        if (moved.count > 0) {
          await this.prisma.proctorEvent.create({
            data: {
              attemptId: attempt.id,
              type: 'DEVICE_AUTO_RELEASED',
              strike: false,
              ip: client.ip,
              deviceId: client.deviceId,
            },
          });
          await this.audit.log({
            actorId: attempt.studentId,
            action: 'attempt.device.auto_release',
            entity: 'Attempt',
            entityId: attempt.id,
            meta: { silentSeconds: Math.round(silentFor / 1000) },
          });
        }
        return;
      }
    }
    if (attempt.deviceId && client.deviceId !== attempt.deviceId) {
      const recent = await this.prisma.proctorEvent.findFirst({
        where: { attemptId: attempt.id, type: 'DEVICE_MISMATCH' },
        orderBy: { createdAt: 'desc' },
      });
      if (!recent || Date.now() - recent.createdAt.getTime() > 30_000) {
        await this.prisma.proctorEvent.create({
          data: {
            attemptId: attempt.id,
            type: 'DEVICE_MISMATCH',
            strike: false,
            ip: client.ip,
            deviceId: client.deviceId,
          },
        });
      }
      throw new ForbiddenException({
        statusCode: 403,
        code: 'DEVICE_MISMATCH',
        message:
          'This exam is already open on another device. Ask your trainer to release it if you need to switch.',
      });
    }
    const patch: Prisma.AttemptUpdateManyMutationInput = {};
    if (!attempt.deviceId && client.deviceId) patch.deviceId = client.deviceId;
    // Heartbeat for "is the bound device still alive", written at most every 20 seconds.
    if (!attempt.lastSeenAt || Date.now() - attempt.lastSeenAt.getTime() > 20_000) {
      patch.lastSeenAt = new Date();
    }
    if (client.ip && client.ip !== attempt.lastIp) patch.lastIp = client.ip;
    if (Object.keys(patch).length) {
      // Binding is conditional so two first requests cannot both claim the attempt.
      await this.prisma.attempt.updateMany({
        where: { id: attempt.id, ...(patch.deviceId ? { deviceId: null } : {}) },
        data: patch,
      });
    }
  }

  /** Auto-submits an attempt whose time is up. Lazy, so no timer has to be running. */
  private async settle(attempt: Attempt): Promise<Attempt> {
    const overdue =
      attempt.status === 'IN_PROGRESS' && Date.now() >= attempt.deadlineAt.getTime() + GRACE_MS;
    if (!overdue) return attempt;
    await this.grading.settleExpired(attempt);
    return this.prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
  }

  private assertWritable(attempt: Attempt): void {
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ConflictException('This attempt has already ended');
    }
    if (Date.now() >= attempt.deadlineAt.getTime() + GRACE_MS) {
      throw new ConflictException('Time is up');
    }
  }
}
