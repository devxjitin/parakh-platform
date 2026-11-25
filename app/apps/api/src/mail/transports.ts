import { Logger } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createTransport } from 'nodemailer';

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Where a reply goes, when it is not the sender (for example a contact-form visitor). */
  replyTo?: string;
  attachments?: MailAttachment[];
}

export interface MailTransport {
  /** Resolves with the provider's message id when it gives one. */
  send(message: MailMessage): Promise<string | undefined>;
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');
const encodeHeader = (s: string) =>
  /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

/**
 * Builds a multipart email with attachments. SES's simple API cannot attach files, so mail with
 * an attachment is sent as raw MIME.
 */
export function buildRawEmail(from: string, message: MailMessage): Buffer {
  const mixed = `=_mixed_${Math.random().toString(36).slice(2)}`;
  const alt = `=_alt_${Math.random().toString(36).slice(2)}`;
  const part = (type: string, body: string) =>
    `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(
      Buffer.from(body, 'utf8').toString('base64'),
    )}\r\n`;
  const lines = [
    `From: ${from}`,
    `To: ${message.to}`,
    ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    part('text/plain', message.text),
    `--${alt}`,
    part('text/html', message.html),
    `--${alt}--`,
  ];
  for (const a of message.attachments ?? []) {
    const name = a.filename.replace(/[^A-Za-z0-9._-]/g, '_');
    lines.push(
      `--${mixed}`,
      `Content-Type: ${a.contentType}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrap76(a.content.toString('base64')),
    );
  }
  lines.push(`--${mixed}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

export class SesTransport implements MailTransport {
  private readonly client: SESv2Client;

  constructor(
    region: string,
    private readonly from: string,
    private readonly configurationSet?: string,
  ) {
    this.client = new SESv2Client({ region });
  }

  async send(message: MailMessage): Promise<string | undefined> {
    const from = `Parakh <${this.from}>`;
    const res = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [message.to] },
        ConfigurationSetName: this.configurationSet,
        ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
        Content: message.attachments?.length
          ? { Raw: { Data: buildRawEmail(from, message) } }
          : {
              Simple: {
                Subject: { Data: message.subject, Charset: 'UTF-8' },
                Body: {
                  Text: { Data: message.text, Charset: 'UTF-8' },
                  Html: { Data: message.html, Charset: 'UTF-8' },
                },
              },
            },
      }),
    );
    return res.MessageId;
  }
}

/** Any SMTP server (Brevo, Zoho, Gmail, Resend SMTP, Mailgun and so on). */
export interface SmtpOptions {
  host: string;
  port: number;
  /** true for port 465 (implicit TLS); false for 587/25, which upgrade with STARTTLS. */
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpTransport implements MailTransport {
  private readonly transporter;
  private readonly from: string;

  constructor(opts: SmtpOptions) {
    this.from = opts.from.includes('<') ? opts.from : `Parakh <${opts.from}>`;
    this.transporter = createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: MailMessage): Promise<string | undefined> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: a.content,
      })),
    });
    return info.messageId;
  }
}

/** Development only: prints the email (including codes) to the console. */
export class LogTransport implements MailTransport {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<string | undefined> {
    const files = message.attachments?.map((a) => a.filename).join(', ');
    this.logger.log(
      `To: ${message.to} | ${message.subject}${files ? ` | attachments: ${files}` : ''}\n${message.text}`,
    );
    return `log_${Date.now()}`;
  }
}

/** Tests only: keeps messages in memory so a test can read the OTP code. */
export class MemoryTransport implements MailTransport {
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<string | undefined> {
    this.outbox.push(message);
    return `mem_${this.outbox.length}`;
  }

  lastTo(email: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to === email);
  }

  clear(): void {
    this.outbox.length = 0;
  }
}
