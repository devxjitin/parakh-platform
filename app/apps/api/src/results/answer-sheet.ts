import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import type { StudentResultDto } from '@parakh/shared';

const W = 595.28; // A4 portrait, points
const H = 841.89;
const MARGIN = 48;
const INK = rgb(0.1, 0.1, 0.15);
const GREY = rgb(0.4, 0.42, 0.47);
const GREEN = rgb(0.09, 0.55, 0.3);
const RED = rgb(0.75, 0.15, 0.15);

/** The built-in PDF fonts only cover Latin text; anything else is shown as "?" instead of failing. */
function safe(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s.replace(/[\r\t]+/g, ' ')) {
    if (ch === '\n') {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function lines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of safe(font, text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      // A single very long word is cut so it never runs off the page.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

const letter = (i: number) => String.fromCharCode(65 + i);
const num = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The student's answer sheet: every question with what they answered, the correct answer, the
 * marks and any explanation or feedback. Sent only once results are released, so it is safe to
 * show the answer key.
 */
export async function renderAnswerSheet(input: {
  studentName: string;
  result: StudentResultDto;
}): Promise<Buffer> {
  const { result } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(`Answer sheet - ${result.examTitle}`);
  doc.setAuthor('Parakh by NandiVex Technologies');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([W, H]);
  let y = H - MARGIN;
  const width = W - MARGIN * 2;

  const room = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([W, H]);
      y = H - MARGIN;
    }
  };
  const write = (
    text: string,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number } = {},
  ) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const indent = opts.indent ?? 0;
    for (const line of lines(font, text, size, width - indent)) {
      room(size + 4);
      page.drawText(line, {
        x: MARGIN + indent,
        y: y - size,
        size,
        font,
        color: opts.color ?? INK,
      });
      y -= size + 4;
    }
  };

  write('Answer sheet', { font: bold, size: 20 });
  y -= 4;
  write(result.examTitle, { font: bold, size: 13 });
  write(`Student: ${input.studentName}`, { color: GREY });
  write(
    `Score: ${num(result.score)} / ${num(result.maxScore)} (${num(result.percent)}%)   ${
      result.passed ? 'Passed' : 'Not passed'
    }`,
    { font: bold, size: 11 },
  );
  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: W - MARGIN, y },
    thickness: 0.6,
    color: GREY,
  });
  y -= 14;

  for (const q of result.questions) {
    room(60);
    write(`Q${q.number}. ${q.body}${q.dropped ? '  (dropped: full marks to everyone)' : ''}`, {
      font: bold,
      size: 11,
    });
    if (q.type === 'SUBJECTIVE') {
      write('Your answer:', { color: GREY, indent: 10 });
      write(q.text?.trim() ? q.text : '(left blank)', { indent: 10 });
      if (q.feedback) write(`Feedback: ${q.feedback}`, { indent: 10, color: GREY });
    } else {
      q.options.forEach((opt, i) => {
        const picked = q.selected.includes(i);
        const correct = q.correctOptions.includes(i);
        const tags = [picked ? 'your answer' : '', correct ? 'correct' : ''].filter(Boolean);
        write(`${letter(i)}. ${opt}${tags.length ? `   [${tags.join(', ')}]` : ''}`, {
          indent: 10,
          font: picked || correct ? bold : regular,
          color: correct ? GREEN : picked ? RED : INK,
        });
      });
      if (q.selected.length === 0)
        write('You did not answer this question.', { indent: 10, color: GREY });
    }
    write(`Marks: ${num(q.marksAwarded)} / ${num(q.marks)}`, {
      indent: 10,
      font: bold,
      color: q.marksAwarded >= q.marks ? GREEN : q.marksAwarded > 0 ? INK : RED,
    });
    if (q.explanation) write(`Explanation: ${q.explanation}`, { indent: 10, color: GREY });
    y -= 10;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `Parakh by NandiVex Technologies   |   Page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: W / 2 - regular.widthOfTextAtSize(label, 8) / 2,
      y: 24,
      size: 8,
      font: regular,
      color: GREY,
    });
  });
  return Buffer.from(await doc.save());
}
