import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import {
  CERT_ACCENT_HEX,
  CERT_KIND_TITLE,
  CERT_SIGNATORY,
  DEFAULT_CERT_MESSAGE,
  type CertKind,
} from '@parakh/shared';
import { NANDIVEX_LOGO_BASE64 } from './nandivex-logo';
import { CERT_SIGNATURE_BASE64 } from './signature';

export interface CertificateFacts {
  holderName: string;
  examTitle: string;
  orgName: string | null;
  kind: CertKind;
  scorePercent: number;
  /** Trainer certificates: how many students took the exam. */
  participants?: number | null;
  /** Draws a faint SAMPLE mark across it (previews and website samples). */
  sample?: boolean;
  issuedOn: Date;
  serialNo: string;
  verifyUrl: string;
}

const W = 841.89; // A4 landscape, points
const H = 595.28;

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const GREY = rgb(0.38, 0.4, 0.45);
// NandiVex palette (nandivex.in): deep purple text, orange as the small highlight.
const INK = rgb(0x2a / 255, 0x1b / 255, 0x47 / 255);
const ORANGE = rgb(1, 0xb0 / 255, 0x20 / 255);

/** The built-in PDF fonts only cover Latin text; anything else is shown as "?" instead of failing. */
function safe(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s.replace(/[\r\n\t]+/g, ' ')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function fit(font: PDFFont, text: string, size: number, maxWidth: number, min = 10): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > maxWidth) s -= 1;
  return s;
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(last + '…', size) > maxWidth) {
      last = last.slice(0, -1);
    }
    kept[maxLines - 1] = last.replace(/\s+$/, '') + '...';
    return kept;
  }
  return lines;
}

async function embedImage(doc: PDFDocument, bytes: Buffer | null): Promise<PDFImage | null> {
  if (!bytes) return null;
  try {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null; // a broken logo must not stop the certificate
  }
}

function drawImageFit(
  page: PDFPage,
  img: PDFImage,
  box: { x: number; y: number; w: number; h: number },
  align: 'left' | 'right' | 'center' = 'left',
) {
  const scale = Math.min(box.w / img.width, box.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x =
    align === 'left' ? box.x : align === 'right' ? box.x + box.w - w : box.x + (box.w - w) / 2;
  page.drawImage(img, { x, y: box.y + (box.h - h) / 2, width: w, height: h });
}

const longDate = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Draws one certificate as an A4 landscape PDF: the trainer's logo and the NandiVex logo, the
 * holder, the exam, a signature line, the serial number and a QR code that opens the public
 * verification page.
 */
export async function renderCertificate(input: {
  facts: CertificateFacts;
  trainerLogo: Buffer | null;
  /** A NandiVex-run exam: only the NandiVex logo, centred at the top. */
  nandivexOnly?: boolean;
}): Promise<Buffer> {
  const { facts } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`${CERT_KIND_TITLE[facts.kind]} - ${facts.serialNo}`);
  doc.setAuthor('Parakh by NandiVex Technologies');
  doc.setProducer('Parakh');
  const page = doc.addPage([W, H]);

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  // One fixed design for every certificate. The trainer only chooses the logo.
  const accent = hexToRgb(CERT_ACCENT_HEX);

  const nandivex = await embedImage(doc, Buffer.from(NANDIVEX_LOGO_BASE64, 'base64'));
  const trainer = input.nandivexOnly ? null : await embedImage(doc, input.trainerLogo);
  const signature = await embedImage(
    doc,
    CERT_SIGNATURE_BASE64 ? Buffer.from(CERT_SIGNATURE_BASE64, 'base64') : null,
  );
  const qr = await embedImage(
    doc,
    await QRCode.toBuffer(facts.verifyUrl, { margin: 1, width: 300, errorCorrectionLevel: 'M' }),
  );

  // ---- frame
  const cx = W / 2;
  const safeLeft = 78;
  const safeRight = W - 78;

  // Spaced capitals read as a modern title; the built-in fonts have no letter-spacing of their own.
  const drawSpaced = (
    text: string,
    font: PDFFont,
    size: number,
    y: number,
    color: ReturnType<typeof rgb>,
    tracking: number,
  ) => {
    const chars = [...text];
    const width =
      chars.reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, size), 0) +
      tracking * (chars.length - 1);
    let x = cx - width / 2;
    for (const ch of chars) {
      page.drawText(ch, { x, y, size, font, color });
      x += font.widthOfTextAtSize(ch, size) + tracking;
    }
  };
  const drawCentred = (
    text: string,
    font: PDFFont,
    size: number,
    y: number,
    color: ReturnType<typeof rgb>,
  ) =>
    page.drawText(text, { x: cx - font.widthOfTextAtSize(text, size) / 2, y, size, font, color });

  // ---- frame: a hairline border and two diagonal corner accents (purple band, orange stripe)
  page.drawRectangle({
    x: 18,
    y: 18,
    width: W - 36,
    height: H - 36,
    borderColor: rgb(0.86, 0.84, 0.92),
    borderWidth: 1,
  });
  page.drawSvgPath('M 0 0 L 104 0 L 0 104 Z', { x: 0, y: H, color: accent });
  page.drawSvgPath('M 104 0 L 118 0 L 0 118 L 0 104 Z', { x: 0, y: H, color: ORANGE });
  page.drawSvgPath('M 0 0 L -104 0 L 0 -104 Z', { x: W, y: 0, color: accent });
  page.drawSvgPath('M -104 0 L -118 0 L 0 -118 L 0 -104 Z', { x: W, y: 0, color: ORANGE });

  // ---- logos: trainer on the left, NandiVex on the right. With no trainer logo (or a NandiVex-run
  // exam) the NandiVex logo sits alone at the top centre.
  const logoY = H - 112;
  if (!trainer) {
    if (nandivex) drawImageFit(page, nandivex, { x: cx - 80, y: logoY, w: 160, h: 66 }, 'center');
  } else {
    drawImageFit(page, trainer, { x: safeLeft + 40, y: logoY, w: 130, h: 66 }, 'left');
    if (nandivex)
      drawImageFit(page, nandivex, { x: safeRight - 40 - 130, y: logoY, w: 130, h: 66 }, 'right');
  }

  // ---- title: CERTIFICATE / OF ACHIEVEMENT
  const subtitle = safe(
    bold,
    CERT_KIND_TITLE[facts.kind].replace(/^Certificate\s+/i, ''),
  ).toUpperCase();
  drawSpaced('CERTIFICATE', bold, 46, H - 178, INK, 9);
  drawSpaced(subtitle, regular, 16, H - 206, accent, 5);
  page.drawRectangle({ x: cx - 28, y: H - 222, width: 56, height: 3, color: ORANGE });

  // ---- presented to
  drawSpaced('THIS CERTIFICATE IS PROUDLY PRESENTED TO', regular, 10.5, H - 252, GREY, 2.4);

  const name = safe(serif, facts.holderName);
  const nameSize = fit(serif, name, 44, safeRight - safeLeft - 60, 20);
  const nameY = H - 304;
  drawCentred(name, serif, nameSize, nameY, INK);
  const nameWidth = Math.max(serif.widthOfTextAtSize(name, nameSize), 280);
  page.drawLine({
    start: { x: cx - nameWidth / 2 - 10, y: nameY - 12 },
    end: { x: cx + nameWidth / 2 + 10, y: nameY - 12 },
    thickness: 0.8,
    color: accent,
    opacity: 0.55,
  });

  // ---- what it is for
  let y = nameY - 44;
  drawCentred(safe(regular, DEFAULT_CERT_MESSAGE[facts.kind]), regular, 14, y, GREY);
  y -= 30;
  const examLines = wrap(bold, safe(bold, facts.examTitle), 22, safeRight - safeLeft - 120, 2);
  for (const line of examLines) {
    drawCentred(line, bold, 22, y, INK);
    y -= 27;
  }
  const detail =
    facts.kind === 'TRAINER'
      ? `${facts.participants ?? 0} student${facts.participants === 1 ? '' : 's'} took the exam`
      : `with a score of ${Math.round(facts.scorePercent * 10) / 10}%`;
  drawCentred(detail, regular, 12.5, y - 2, accent);

  // ---- bottom row: signature | date of issue | QR and serial
  const lineY = 104;
  const sigX = safeLeft + 12;
  if (signature) drawImageFit(page, signature, { x: sigX, y: lineY + 4, w: 170, h: 52 }, 'left');
  page.drawLine({
    start: { x: sigX, y: lineY },
    end: { x: sigX + 180, y: lineY },
    thickness: 0.8,
    color: INK,
  });
  const sigName = safe(bold, CERT_SIGNATORY.name);
  page.drawText(sigName, {
    x: sigX,
    y: lineY - 15,
    size: fit(bold, sigName, 12, 180),
    font: bold,
    color: INK,
  });
  const sigTitle = safe(regular, CERT_SIGNATORY.title);
  page.drawText(sigTitle, {
    x: sigX,
    y: lineY - 29,
    size: fit(regular, sigTitle, 10, 180),
    font: regular,
    color: GREY,
  });

  const issued = longDate(facts.issuedOn);
  drawCentred(issued, bold, 13, lineY + 8, INK);
  page.drawLine({
    start: { x: cx - 80, y: lineY },
    end: { x: cx + 80, y: lineY },
    thickness: 0.8,
    color: INK,
  });
  drawSpaced('DATE OF ISSUE', regular, 9, lineY - 15, GREY, 2);

  const qrSize = 76;
  const qrX = safeRight - 12 - qrSize;
  if (qr) page.drawImage(qr, { x: qrX, y: lineY - 12, width: qrSize, height: qrSize });
  const serial = `Serial ${facts.serialNo}`;
  const serialSize = fit(bold, serial, 9, 170, 6);
  page.drawText(serial, {
    x: qrX + qrSize / 2 - bold.widthOfTextAtSize(serial, serialSize) / 2,
    y: lineY - 24,
    size: serialSize,
    font: bold,
    color: INK,
  });
  const scan = 'Scan to verify this certificate';
  page.drawText(scan, {
    x: qrX + qrSize / 2 - regular.widthOfTextAtSize(scan, 7.5) / 2,
    y: lineY - 35,
    size: 7.5,
    font: regular,
    color: GREY,
  });
  const issuer = 'Issued through Parakh by NandiVex Technologies';
  drawCentred(issuer, regular, 8, 38, GREY);

  if (facts.sample) {
    const mark = 'SAMPLE';
    const size = 120;
    page.drawText(mark, {
      x: W / 2 - (bold.widthOfTextAtSize(mark, size) / 2) * Math.cos(Math.PI / 7),
      y: H / 2 - 100,
      size,
      font: bold,
      color: INK,
      opacity: 0.07,
      rotate: degrees(26),
    });
  }

  return Buffer.from(await doc.save());
}
