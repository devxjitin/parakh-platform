'use client';

import { QUESTION_TYPE_LABELS } from '@parakh/shared';
import { Icon } from './icons';

interface PreviewQuestion {
  type: string;
  body: string;
  options: string[];
  correctOptions: number[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const SHOWN = 5;

/**
 * What the pasted text turned into, shown before anything is imported: how many questions were
 * found, how they split by type, and a readable list to check the answers against.
 */
export function ImportPreview({ questions }: { questions: PreviewQuestion[] }) {
  const count = (t: string) => questions.filter((q) => q.type === t).length;
  const kinds = (['SINGLE', 'MULTI', 'SUBJECTIVE'] as const).filter((k) => count(k) > 0);
  const shown = questions.slice(0, SHOWN);
  const more = questions.length - shown.length;

  return (
    <section className="import-preview" aria-label="Questions found in the text">
      <header className="ip-head">
        <span className="ip-ico">
          <Icon name="check" size={16} />
        </span>
        <div>
          <strong>{plural(questions.length, 'question', 'questions')} found</strong>
          <small>Check the correct answers below, then import.</small>
        </div>
        <div className="ip-kinds">
          {kinds.map((k) => (
            <span key={k} className="ip-kind">
              {QUESTION_TYPE_LABELS[k]} <b>{count(k)}</b>
            </span>
          ))}
        </div>
      </header>

      <ol className="ip-list">
        {shown.map((q, i) => (
          <li key={i} className="ip-item">
            <span className="ip-num">{i + 1}</span>
            <div className="ip-main">
              <p className="ip-body">{q.body}</p>
              {q.options.length > 0 && (
                <ul className="ip-options">
                  {q.options.map((o, idx) => (
                    <li key={idx} className={q.correctOptions.includes(idx) ? 'correct' : ''}>
                      <b>{String.fromCharCode(65 + idx)}</b>
                      <span>{o}</span>
                      {q.correctOptions.includes(idx) && <Icon name="check" size={13} />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <span className="ip-type">
              {QUESTION_TYPE_LABELS[q.type as keyof typeof QUESTION_TYPE_LABELS] ?? q.type}
            </span>
          </li>
        ))}
      </ol>
      {more > 0 && <p className="ip-more">+ {plural(more, 'more question', 'more questions')}</p>}
    </section>
  );
}
