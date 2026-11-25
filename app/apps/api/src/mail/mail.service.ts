import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import {
  LogTransport,
  MailMessage,
  MailTransport,
  MemoryTransport,
  SesTransport,
  SmtpTransport,
} from './transports';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export function createTransport(env: Env): MailTransport {
  switch (env.MAIL_TRANSPORT) {
    case 'ses':
      return new SesTransport(env.AWS_REGION, env.SES_FROM_EMAIL, env.SES_CONFIGURATION_SET);
    case 'smtp':
      return new SmtpTransport({
        host: env.SMTP_HOST as string,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : env.SMTP_PORT === 465,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.SMTP_FROM || env.SES_FROM_EMAIL,
      });
    case 'memory':
      return new MemoryTransport();
    default:
      return new LogTransport();
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 16px">${esc(title)}</h2>${bodyHtml}
<p style="color:#666;font-size:12px;margin-top:32px">Parakh by NandiVex Technologies. If you did not request this, you can ignore this email.</p></div>`;
}

function codeBlock(code: string): string {
  return `<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:16px 0">${esc(code)}</p>`;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Sends the email; failures are logged, never thrown (the user can request another code). */
  private async deliver(message: MailMessage): Promise<void> {
    try {
      await this.transport.send(message);
    } catch (err) {
      this.logger.error(`Failed to send "${message.subject}" email`, err as Error);
    }
  }

  /** Sends a certificate with its PDF attached. Throws on failure so the caller can retry. */
  async sendCertificate(
    to: string,
    name: string,
    r: { examTitle: string; serialNo: string; verifyUrl: string; pdf: Buffer },
  ): Promise<string | undefined> {
    return this.transport.send({
      to,
      subject: `Your certificate for "${r.examTitle}"`,
      text: `Hi ${name},\n\nCongratulations! Your certificate for "${r.examTitle}" is attached.\n\nSerial: ${r.serialNo}\nAnyone can check it is genuine at:\n${r.verifyUrl}\n`,
      html: layout(
        'Your certificate is ready',
        `<p>Hi ${esc(name)}, your certificate for <strong>${esc(r.examTitle)}</strong> is attached to this email.</p><p style="font-size:14px">Serial: <strong>${esc(r.serialNo)}</strong><br>Anyone can check it is genuine at <a href="${esc(r.verifyUrl)}">${esc(r.verifyUrl)}</a></p>`,
      ),
      attachments: [
        {
          filename: `certificate-${r.serialNo}.pdf`,
          contentType: 'application/pdf',
          content: r.pdf,
        },
      ],
    });
  }

  sendVerificationCode(to: string, name: string, code: string) {
    const minutes = this.env.OTP_TTL_MIN;
    return this.deliver({
      to,
      subject: 'Verify your Parakh email',
      text: `Hi ${name},\n\nYour Parakh verification code is ${code}. It expires in ${minutes} minutes.\n`,
      html: layout(
        'Verify your email',
        `<p>Hi ${esc(name)}, use this code to verify your email. It expires in ${minutes} minutes.</p>${codeBlock(code)}`,
      ),
    });
  }

  sendPasswordResetCode(to: string, name: string, code: string) {
    const minutes = this.env.OTP_TTL_MIN;
    return this.deliver({
      to,
      subject: 'Reset your Parakh password',
      text: `Hi ${name},\n\nYour password reset code is ${code}. It expires in ${minutes} minutes.\n`,
      html: layout(
        'Reset your password',
        `<p>Hi ${esc(name)}, use this code to reset your password. It expires in ${minutes} minutes.</p>${codeBlock(code)}`,
      ),
    });
  }

  /** Tells an admin that a customer paid but received nothing, so a refund is due. */
  sendRefundNeeded(to: string, r: { receiptNo: string; amountPaise: number; reason: string }) {
    const amount = '₹' + (r.amountPaise / 100).toFixed(2);
    return this.deliver({
      to,
      subject: `Refund needed: ${r.receiptNo}`,
      text: `Payment ${r.receiptNo} (${amount}) was taken but nothing was delivered (${r.reason}).
Open Admin > Payments and refund it.
`,
      html: layout(
        'Refund needed',
        `<p>Payment <b>${esc(r.receiptNo)}</b> (${esc(amount)}) was taken but nothing was delivered (${esc(r.reason)}). Open Admin &gt; Payments and refund it.</p>`,
      ),
    });
  }

  /** The daily Razorpay-versus-database check found differences the admin should look at. */
  sendReconciliationReport(to: string, r: { day: string; lines: string[] }) {
    const list = r.lines.map((l) => `- ${l}`).join('\n');
    return this.deliver({
      to,
      subject: `Payment reconciliation ${r.day}: ${r.lines.length} mismatch(es)`,
      text: `The daily payment check for ${r.day} found ${r.lines.length} mismatch(es) between Razorpay and the database:

${list}

Open Admin > Payments to look into them.
`,
      html: layout(
        `Payment reconciliation ${r.day}`,
        `<p>The daily payment check found <b>${r.lines.length}</b> mismatch(es) between Razorpay and the database:</p><ul style="font-size:14px">${r.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p>Open Admin &gt; Payments to look into them.</p>`,
      ),
    });
  }

  /** The trainer paid to publish, but the exam's closing time had already passed. */
  sendWindowPassed(to: string, name: string, r: { examTitle: string }) {
    return this.deliver({
      to,
      subject: `"${r.examTitle}" was not published: its closing time has passed`,
      text: `Hi ${name},

Your payment for "${r.examTitle}" went through after the exam's closing time had already passed, so we did not publish it and no students were invited. Your payment will be refunded in full. To run the exam, set a new schedule on the draft and publish it again.
`,
      html: layout(
        'Exam not published',
        `<p>Hi ${esc(name)}, your payment for <strong>${esc(r.examTitle)}</strong> went through after the exam's closing time had already passed, so we did not publish it and no students were invited. <strong>Your payment will be refunded in full.</strong> To run the exam, set a new schedule on the draft and publish it again.</p>`,
      ),
    });
  }

  /** To the support inbox. Throws on failure, so the visitor can be told to write by email. */
  async sendContactMessage(
    inbox: string,
    r: {
      name: string;
      email: string;
      phone?: string;
      company?: string;
      topic?: string;
      budget?: string;
      message: string;
    },
  ): Promise<void> {
    const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
    const rows: [string, string | undefined][] = [
      ['Name', r.name],
      ['Email', r.email],
      ['Phone', r.phone],
      ['Company', r.company],
      ['Topic', r.topic],
      ['Budget', r.budget],
    ];
    const shown = rows.filter(([, v]) => v && v.trim());
    const text = `${shown.map(([k, v]) => `${k}: ${clean(v!)}`).join('\n')}\n\n${r.message}\n`;
    const html = layout(
      'New message from the website',
      `<p>${shown.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(clean(v!))}`).join('<br>')}</p><p style="white-space:pre-wrap">${esc(r.message)}</p>`,
    );
    await this.transport.send({
      to: inbox,
      replyTo: r.email,
      subject:
        `Website enquiry from ${clean(r.name)}${r.topic ? ` (${clean(r.topic)})` : ''}`.slice(
          0,
          200,
        ),
      text,
      html,
    });
  }

  /** Tells the visitor their message arrived. */
  sendContactReceipt(to: string, name: string) {
    return this.deliver({
      to,
      subject: 'We got your message',
      text: `Hi ${name},\n\nThanks for writing to NandiVex Technologies. We have your message and will reply within two working days.\n`,
      html: layout(
        'We got your message',
        `<p>Hi ${esc(name)}, thanks for writing to NandiVex Technologies. We have your message and will reply within two working days.</p>`,
      ),
    });
  }

  sendAccountExists(to: string, name: string) {
    return this.deliver({
      to,
      subject: 'You already have an Parakh account',
      text: `Hi ${name},\n\nSomeone tried to register with this email, but you already have an account. Sign in, or use "Forgot password" if needed.\n`,
      html: layout(
        'You already have an account',
        `<p>Hi ${esc(name)}, someone tried to register with this email, but you already have an account. Sign in, or use “Forgot password” if you need to reset it.</p>`,
      ),
    });
  }

  /** Sent to the old address after an account was closed, so a stranger cannot do it unnoticed. */
  sendAccountDeleted(to: string, name: string) {
    return this.deliver({
      to,
      subject: 'Your Parakh account was closed',
      text: `Hi ${name},\n\nYour Parakh account was closed and your name, email and phone were removed. Payment records and issued certificates are kept, as our privacy policy explains.\n\nIf this was not you, contact us straight away through the contact page.\n`,
      html: layout(
        'Your account was closed',
        `<p>Hi ${esc(name)}, your Parakh account was closed and your name, email and phone were removed. Payment records and issued certificates are kept, as our privacy policy explains.</p><p>If this was not you, contact us straight away through the contact page.</p>`,
      ),
    });
  }

  sendPasswordChanged(to: string, name: string) {
    return this.deliver({
      to,
      subject: 'Your Parakh password was changed',
      text: `Hi ${name},\n\nYour password was just changed. If this was not you, reset your password immediately.\n`,
      html: layout(
        'Password changed',
        `<p>Hi ${esc(name)}, your password was just changed. If this was not you, reset your password immediately.</p>`,
      ),
    });
  }

  sendPublishReceipt(
    to: string,
    name: string,
    r: { examTitle: string; code: string; receiptNo: string; amountPaise: number; paidAt: Date },
  ) {
    const rupees = (r.amountPaise / 100).toFixed(2);
    const joinUrl = `${this.env.WEB_ORIGIN.split(',')[0].trim()}/join/?code=${encodeURIComponent(r.code)}`;
    const date = r.paidAt.toISOString().slice(0, 10);
    return this.deliver({
      to,
      subject: `Receipt ${r.receiptNo}: your exam is published`,
      text: `Hi ${name},

Your exam "${r.examTitle}" is published.

Exam code: ${r.code}
Share link: ${joinUrl}

Receipt ${r.receiptNo}, ${date}
Exam creation fee: INR ${rupees} (final price, no GST added)
`,
      html: layout(
        'Your exam is published',
        `<p>Hi ${esc(name)}, your exam <strong>${esc(r.examTitle)}</strong> is published. Share this code with your students:</p>${codeBlock(r.code)}<p>Or send them <a href="${esc(joinUrl)}">${esc(joinUrl)}</a></p><hr style="border:0;border-top:1px solid #ddd;margin:20px 0"><p style="font-size:14px">Receipt <strong>${esc(r.receiptNo)}</strong> · ${date}<br>Exam creation fee: INR ${rupees} (final price, no GST added)</p>`,
      ),
    });
  }

  /**
   * "Your results are out": ONE email per student with the score, the answer sheet and, when the
   * exam gives one, the certificate. Throws when it cannot be sent so the caller can retry.
   * Certificates are mentioned only when there is one to attach.
   */
  async sendResultsPackage(
    to: string,
    name: string,
    r: {
      examTitle: string;
      score: number;
      maxScore: number;
      percent: number;
      passed: boolean;
      answerSheet: Buffer;
      certificate?: { kind: string; serialNo: string; verifyUrl: string; pdf: Buffer };
    },
  ): Promise<string | undefined> {
    const line = `Your score: ${r.score} / ${r.maxScore} (${r.percent}%) - ${r.passed ? 'Passed' : 'Not passed'}.`;
    const attachments = [
      {
        filename: 'answer-sheet.pdf',
        contentType: 'application/pdf',
        content: r.answerSheet,
      },
    ];
    let certText = '';
    let certHtml = '';
    if (r.certificate) {
      const what =
        r.certificate.kind === 'ACHIEVEMENT'
          ? 'Certificate of Achievement'
          : 'Certificate of Participation';
      attachments.unshift({
        filename: `certificate-${r.certificate.serialNo}.pdf`,
        contentType: 'application/pdf',
        content: r.certificate.pdf,
      });
      certText = `
Your ${what} is attached (serial ${r.certificate.serialNo}). Anyone can check it is genuine at:
${r.certificate.verifyUrl}
`;
      certHtml = `<p>Your <strong>${what}</strong> is attached.</p><p style="font-size:14px">Serial: <strong>${esc(r.certificate.serialNo)}</strong><br>Anyone can check it is genuine at <a href="${esc(r.certificate.verifyUrl)}">${esc(r.certificate.verifyUrl)}</a></p>`;
    }
    return this.transport.send({
      to,
      subject: `Your results are out: ${r.examTitle}`,
      text: `Hi ${name},

The results for "${r.examTitle}" are published.
${line}
${certText}
Your answer sheet is attached: every question with your answer, the correct answer and your marks.

A practice code for the same questions will be emailed to you separately.
`,
      html: layout(
        'Your results are out',
        `<p>Hi ${esc(name)}, the results for <strong>${esc(r.examTitle)}</strong> are published.</p><p style="font-size:18px"><strong>${esc(line)}</strong></p>${certHtml}<p>Your answer sheet is attached: every question with your answer, the correct answer and your marks.</p><p>A practice code for the same questions will be emailed to you separately.</p>`,
      ),
      attachments,
    });
  }

  /** One reminder, about a day before an exam the student has joined. */
  /** The exam a student paid for was cancelled. Fees are not refunded; say so plainly. */
  sendExamCancelled(
    to: string,
    name: string,
    r: { examTitle: string; reason: string; refunded: boolean },
  ) {
    const url = `${this.env.WEB_ORIGIN.split(',')[0].trim()}/refund-policy/`;
    const moneyText = r.refunded
      ? 'You had not started, so your fee is being refunded in full to your original payment source. You will get a separate email when it is done. Refund policy'
      : 'Please see our refund policy for what applies to you';
    const moneyHtml = r.refunded
      ? 'You had not started, so your fee is being <strong>refunded in full</strong> to your original payment source. You will get a separate email when it is done.'
      : `Please see our <a href="${esc(url)}">refund policy</a> for what applies to you.`;
    return this.deliver({
      to,
      subject: `Exam cancelled: ${r.examTitle}`,
      text: `Hi ${name},\n\nThe exam "${r.examTitle}" has been cancelled and can no longer be joined or started.\n\nReason: ${r.reason}\n\n${moneyText}: ${url}\n\nIf you were charged by mistake, write to us from the contact page.\n`,
      html: layout(
        'Your exam was cancelled',
        `<p>Hi ${esc(name)}, the exam <strong>${esc(r.examTitle)}</strong> has been cancelled and can no longer be joined or started.</p><p style="font-size:14px">Reason: ${esc(r.reason)}</p><p style="font-size:14px">${moneyHtml} If you were charged by mistake, write to us from the contact page.</p>`,
      ),
    });
  }

  /** Trainer reminder (and, with `forAdmin`, the escalation to admins) that results are overdue. */
  sendResultsOverdue(
    to: string,
    name: string,
    r: { examTitle: string; days: number; waiting: number; forAdmin?: { trainer: string } },
  ) {
    const url = `${this.env.WEB_ORIGIN.split(',')[0].trim()}/exams/`;
    const who = r.forAdmin
      ? `The exam "${r.examTitle}" by ${r.forAdmin.trainer} closed ${r.days} days ago and its results are still not published. ${r.waiting} student(s) are waiting.`
      : `Your exam "${r.examTitle}" closed ${r.days} days ago and its results are not published yet. ${r.waiting} student(s) who paid are waiting for their marks. Please mark any written answers and publish the results.`;
    return this.deliver({
      to,
      subject: r.forAdmin
        ? `Results overdue: ${r.examTitle}`
        : `Please publish the results of "${r.examTitle}"`,
      text: `Hi ${name},\n\n${who}\n\nOpen the exam: ${url}\n`,
      html: layout(
        r.forAdmin ? 'Results overdue' : 'Please publish your results',
        `<p>Hi ${esc(name)}, ${esc(who)}</p><p><a href="${esc(url)}">Open your exams</a></p>`,
      ),
    });
  }

  sendExamRescheduled(
    to: string,
    name: string,
    r: { examTitle: string; startsAt: Date; endsAt: Date; durationMinutes: number },
  ) {
    const url = `${this.env.WEB_ORIGIN.split(',')[0].trim()}/dashboard/`;
    const fmt = (d: Date) =>
      d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    const line = `It now opens on ${fmt(r.startsAt)} and closes on ${fmt(r.endsAt)} (India time). You will have ${r.durationMinutes} minutes once you start.`;
    return this.deliver({
      to,
      subject: `New time for ${r.examTitle}`,
      text: `Hi ${name},\n\nThe time of the exam "${r.examTitle}" has changed. Your seat is unchanged and you do not need to pay again.\n\n${line}\n\nOpen it from your dashboard: ${url}\n`,
      html: layout(
        'The exam time has changed',
        `<p>Hi ${esc(name)}, the time of <strong>${esc(r.examTitle)}</strong> has changed. Your seat is unchanged and you do not need to pay again.</p><p>${esc(line)}</p><p><a href="${esc(url)}">Open your dashboard</a></p>`,
      ),
    });
  }

  sendExamReminder(
    to: string,
    name: string,
    r: { examTitle: string; startsAt: Date; durationMinutes: number },
  ) {
    const url = `${this.env.WEB_ORIGIN.split(',')[0].trim()}/dashboard/`;
    const when = r.startsAt.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return this.deliver({
      to,
      subject: `Reminder: ${r.examTitle} starts soon`,
      text: `Hi ${name},\n\nYour exam "${r.examTitle}" starts on ${when} (India time). You will have ${r.durationMinutes} minutes.\n\nOpen it from your dashboard: ${url}\n\nUse one device and a stable connection; leaving the exam window counts as a strike.\n`,
      html: layout(
        'Your exam starts soon',
        `<p>Hi ${esc(name)}, your exam <strong>${esc(r.examTitle)}</strong> starts on <strong>${esc(when)}</strong> (India time). You will have ${r.durationMinutes} minutes.</p><p><a href="${esc(url)}">Open your dashboard</a></p><p style="font-size:14px">Use one device and a stable connection; leaving the exam window counts as a strike.</p>`,
      ),
    });
  }

  sendPayoutPaid(
    to: string,
    name: string,
    r: { amountPaise: number; utr: string; destination: string; paidAt: Date },
  ) {
    const rupees = (r.amountPaise / 100).toFixed(2);
    const date = r.paidAt.toISOString().slice(0, 10);
    return this.deliver({
      to,
      subject: `Payout of INR ${rupees} sent`,
      text: `Hi ${name},\n\nNandiVex Technologies has sent your Parakh earnings.\n\nAmount: INR ${rupees}\nSent to: ${r.destination}\nReference (UTR): ${r.utr}\nDate: ${date}\n`,
      html: layout(
        'Your payout was sent',
        `<p>Hi ${esc(name)}, NandiVex Technologies has sent your Parakh earnings.</p><p style="font-size:14px">Amount: <strong>INR ${rupees}</strong><br>Sent to: ${esc(r.destination)}<br>Reference (UTR): <strong>${esc(r.utr)}</strong><br>Date: ${date}</p>`,
      ),
    });
  }

  sendRefundNotice(
    to: string,
    name: string,
    r: { amountPaise: number; what: string; reason: string },
  ) {
    const rupees = (r.amountPaise / 100).toFixed(2);
    return this.deliver({
      to,
      subject: `Refund of INR ${rupees}`,
      text: `Hi ${name},\n\nWe have refunded INR ${rupees} for ${r.what}.\nReason: ${r.reason}\nIt reaches your original payment method in a few working days.\n`,
      html: layout(
        'Your refund was issued',
        `<p>Hi ${esc(name)}, we have refunded <strong>INR ${rupees}</strong> for ${esc(r.what)}.</p><p style="font-size:14px">Reason: ${esc(r.reason)}</p><p>It reaches your original payment method in a few working days.</p>`,
      ),
    });
  }

  /** A student asked for their exam fee back; tell the admins so it does not sit unseen. */
  sendRefundRequested(
    to: string,
    r: {
      receiptNo: string;
      amountPaise: number;
      studentName: string;
      examTitle: string;
      reason: string;
    },
  ) {
    const amount = '₹' + (r.amountPaise / 100).toFixed(2);
    return this.deliver({
      to,
      subject: `Refund request: ${r.receiptNo}`,
      text: `${r.studentName} asked for a refund of ${amount} for "${r.examTitle}" (${r.receiptNo}).\nReason: ${r.reason}\nOpen Admin > Payments > Refund requests to approve or reject it.\n`,
      html: layout(
        'Refund request',
        `<p><b>${esc(r.studentName)}</b> asked for a refund of ${esc(amount)} for &ldquo;${esc(r.examTitle)}&rdquo; (${esc(r.receiptNo)}).</p><p style="font-size:14px">Reason: ${esc(r.reason)}</p><p>Open Admin &gt; Payments &gt; Refund requests to approve or reject it.</p>`,
      ),
    });
  }

  sendRefundRequestRejected(
    to: string,
    name: string,
    r: { receiptNo: string; examTitle: string; note: string },
  ) {
    return this.deliver({
      to,
      subject: `Your refund request ${r.receiptNo} was not approved`,
      text: `Hi ${name},\n\nWe could not approve your refund request for "${r.examTitle}" (${r.receiptNo}).\nReason: ${r.note}\n\nIf you think this is wrong, reply through the contact page.\n`,
      html: layout(
        'Refund request not approved',
        `<p>Hi ${esc(name)}, we could not approve your refund request for &ldquo;${esc(r.examTitle)}&rdquo; (${esc(r.receiptNo)}).</p><p style="font-size:14px">Reason: ${esc(r.note)}</p><p>If you think this is wrong, reach us through the contact page.</p>`,
      ),
    });
  }

  sendSeatReceipt(
    to: string,
    name: string,
    r: { examTitle: string; seats: number; receiptNo: string; amountPaise: number; paidAt: Date },
  ) {
    const rupees = (r.amountPaise / 100).toFixed(2);
    const date = r.paidAt.toISOString().slice(0, 10);
    return this.deliver({
      to,
      subject: `Receipt ${r.receiptNo}: ${r.seats} seats for "${r.examTitle}"`,
      text: `Hi ${name},\n\nYou bought ${r.seats} seat(s) for "${r.examTitle}".\n\nReceipt ${r.receiptNo}, ${date}\nTotal: INR ${rupees} (final price, no GST added)\n`,
      html: layout(
        'Seats purchased',
        `<p>Hi ${esc(name)}, you bought <strong>${r.seats}</strong> seat(s) for <strong>${esc(r.examTitle)}</strong>.</p><hr style="border:0;border-top:1px solid #ddd;margin:20px 0"><p style="font-size:14px">Receipt <strong>${esc(r.receiptNo)}</strong> · ${date}<br>Total: INR ${rupees} (final price, no GST added)</p>`,
      ),
    });
  }

  sendJoinReceipt(
    to: string,
    name: string,
    r: {
      examTitle: string;
      code: string;
      startsAt: Date | null;
      endsAt: Date | null;
      receiptNo: string;
      amountPaise: number;
      paidAt: Date;
    },
  ) {
    const rupees = (r.amountPaise / 100).toFixed(2);
    const date = r.paidAt.toISOString().slice(0, 10);
    const window =
      r.startsAt && r.endsAt
        ? `Opens ${r.startsAt.toISOString()} and closes ${r.endsAt.toISOString()} (UTC).`
        : '';
    return this.deliver({
      to,
      subject: `Receipt ${r.receiptNo}: you have joined "${r.examTitle}"`,
      text: `Hi ${name},\n\nYou have joined "${r.examTitle}". ${window}\nTo start, open ${this.joinUrl(r.code)} when the exam opens, confirm your email with the code we send, and press Start.\n\nReceipt ${r.receiptNo}, ${date}\nExam fee: INR ${rupees} (final price, no GST added)\n`,
      html: layout(
        'You have joined the exam',
        `<p>Hi ${esc(name)}, you have joined <strong>${esc(r.examTitle)}</strong>. ${esc(window)} To start the exam, open <a href="${esc(this.joinUrl(r.code))}">the join page</a> when it opens, confirm your email with the code we send, and press Start.</p><hr style="border:0;border-top:1px solid #ddd;margin:20px 0"><p style="font-size:14px">Receipt <strong>${esc(r.receiptNo)}</strong> · ${date}<br>Exam fee: INR ${rupees} (final price, no GST added)</p>`,
      ),
    });
  }

  /** Where a student goes to join (or come back to start) an exam. */
  private joinUrl(code: string): string {
    return `${this.env.WEB_ORIGIN.split(',')[0].trim()}/join/?code=${encodeURIComponent(code)}`;
  }

  /** Students have no password: this code proves they own the email they typed. */
  sendJoinCode(to: string, name: string, examTitle: string, code: string) {
    return this.deliver({
      to,
      subject: `Your Parakh code: ${code}`,
      text: `Hi ${name},

Your code to join "${examTitle}" is ${code}. It expires soon. If you did not ask for it, ignore this email.
`,
      html: layout(
        'Confirm your email',
        `<p>Hi ${esc(name)}, use this code to join <strong>${esc(examTitle)}</strong>:</p>${codeBlock(code)}<p>It expires soon.</p>`,
      ),
    });
  }

  /** A free exam has no payment, so there is no receipt: just confirm the seat. */
  sendJoinConfirmation(
    to: string,
    name: string,
    r: { examTitle: string; code: string; startsAt: Date | null; endsAt: Date | null },
  ) {
    const window =
      r.startsAt && r.endsAt
        ? `Opens ${r.startsAt.toISOString()} and closes ${r.endsAt.toISOString()} (UTC).`
        : '';
    return this.deliver({
      to,
      subject: `You have joined "${r.examTitle}"`,
      text: `Hi ${name},

You have joined "${r.examTitle}" (free, no payment needed). ${window}
To start, open ${this.joinUrl(r.code)}, confirm your email with the code we send, and press Start.
`,
      html: layout(
        'You have joined the exam',
        `<p>Hi ${esc(name)}, you have joined <strong>${esc(r.examTitle)}</strong> (free, no payment needed). ${esc(window)}</p><p><a href="${esc(this.joinUrl(r.code))}">Open the join page</a> to start when the exam opens.</p>`,
      ),
    });
  }

  /** Sent once the exam has closed. Opens the practice set; no payment, no certificate. */
  sendPracticeCode(
    to: string,
    name: string,
    r: { examTitle: string; code: string; expiresAt: Date },
  ) {
    const url = `${this.env.WEB_ORIGIN.split(',')[0].trim()}/practice/?code=${encodeURIComponent(r.code)}`;
    const until = r.expiresAt.toISOString().slice(0, 10);
    return this.deliver({
      to,
      subject: `Practice code for "${r.examTitle}"`,
      text: `Hi ${name},

"${r.examTitle}" has closed. Practise the same questions with instant feedback, free of charge.
Your practice code: ${r.code}
Open ${url} and enter the code. It works until ${until}.

Practice is not an exam: it has no payment and no certificate, and it does not change your score.
`,
      html: layout(
        'Your practice code',
        `<p>Hi ${esc(name)}, <strong>${esc(r.examTitle)}</strong> has closed. Practise the same questions with instant feedback, free of charge.</p>${codeBlock(r.code)}<p><a href="${esc(url)}">Open the practice page</a> and enter the code. It works until ${until}.</p><p style="font-size:13px;color:#555">Practice is not an exam: no payment, no certificate, and it does not change your score.</p>`,
      ),
    });
  }

  /**
   * The exam invite every listed student gets when the exam is published. It never says who paid.
   * When certificates are on, sample PDFs show what a pass (and, if enabled, a fail) earns.
   * When they are off, certificates are not mentioned at all.
   */
  sendExamInvite(
    to: string,
    r: {
      examTitle: string;
      trainerName: string;
      code: string;
      totalMarks: number;
      durationMinutes: number;
      startsAt: Date | null;
      endsAt: Date | null;
      samples?: { passed: Buffer; participation?: Buffer };
    },
  ) {
    const url = this.joinUrl(r.code);
    const fmt = (d: Date) =>
      d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      }) + ' IST';
    const when =
      r.startsAt && r.endsAt ? `Opens ${fmt(r.startsAt)} and closes ${fmt(r.endsAt)}.` : '';
    const attachments: { filename: string; contentType: string; content: Buffer }[] = [];
    let certText = '';
    let certHtml = '';
    if (r.samples) {
      attachments.push({
        filename: 'sample-certificate-pass.pdf',
        contentType: 'application/pdf',
        content: r.samples.passed,
      });
      const both = Boolean(r.samples.participation);
      const tail = both ? 'Both are attached as samples.' : 'A sample is attached.';
      let line = 'pass the exam to receive the Certificate of Achievement';
      if (r.samples.participation) {
        attachments.push({
          filename: 'sample-certificate-participation.pdf',
          contentType: 'application/pdf',
          content: r.samples.participation,
        });
        line += '; if you do not pass, you receive the Certificate of Participation';
      }
      certText = `\nCertificates: ${line}. ${tail}\n`;
      certHtml = `<p><strong>Certificates:</strong> ${line}. ${tail}</p>`;
    }
    return this.deliver({
      to,
      subject: `You are invited to "${r.examTitle}"`,
      text: `Hello,\n\n${r.trainerName} has invited you to the exam "${r.examTitle}" on Parakh.\n\nTotal marks: ${r.totalMarks}\nDuration: ${r.durationMinutes} minutes\n${when}\n\nExam code: ${r.code}\nTo take the exam open ${url}, enter your name and this email address, confirm the code we send you, and press Start.\n${certText}`,
      html: layout(
        'You are invited to an exam',
        `<p>${esc(r.trainerName)} has invited you to the exam <strong>${esc(r.examTitle)}</strong>.</p><p style="font-size:14px">Total marks: <strong>${r.totalMarks}</strong><br>Duration: <strong>${r.durationMinutes} minutes</strong><br>${esc(when)}</p><p>Exam code:</p>${codeBlock(r.code)}<p><a href="${esc(url)}">Open the join page</a>, enter your name and this email address, confirm the code we send you, and press Start.</p>${certHtml}`,
      ),
      attachments,
    });
  }
}
