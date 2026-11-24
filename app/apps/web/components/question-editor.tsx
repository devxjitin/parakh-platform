'use client';

import { useEffect, useRef, useState } from 'react';
import {
  QUESTION_TYPE_LABELS,
  planMarksFor,
  questionInputSchema,
  type ExamQuestionDto,
  type PaperPlan,
} from '@parakh/shared';
import { QuestionImage, QuestionText } from './question-content';
import { Icon } from './icons';
import { Alert, Button, FieldErrors, Req, describeError, validate } from './ui';

type Kind = ExamQuestionDto['type'];

// Used only when the exam has no paper plan: marks are not asked for in the editor.
const DEFAULT_MARKS = 4;

export function QuestionEditor({
  initial,
  examId,
  onSave,
  onDone,
  plan,
}: {
  initial?: ExamQuestionDto;
  examId: string;
  /**
   * Stores the question and returns its id. `id` is undefined until the question exists, so the
   * first save creates it and a later save updates it.
   */
  onSave: (input: unknown, id: string | undefined) => Promise<string>;
  /** The editor closes: after Save question, or when the trainer cancels. */
  onDone: () => void;
  /**
   * The exam's paper plan. When there is one, each question type already has its marks there, so
   * the editor does not ask for marks; without a plan the trainer types them.
   */
  plan?: PaperPlan | null;
}) {
  // With a plan, only the question types the trainer chose for the paper are offered. A question
  // that already exists keeps its own type even if the plan no longer lists it.
  const allowed = (['SINGLE', 'MULTI', 'SUBJECTIVE'] as Kind[]).filter(
    (k) =>
      initial?.type === k ||
      !plan ||
      (k === 'SINGLE' ? plan.singleCount : k === 'MULTI' ? plan.multiCount : plan.subjectiveCount) >
        0,
  );
  const [type, setType] = useState<Kind>(initial?.type ?? allowed[0] ?? 'SINGLE');
  const [body, setBody] = useState(initial?.body ?? '');
  const [markdown, setMarkdown] = useState(initial?.markdown ?? false);
  const [file, setFile] = useState<File>();
  const [imageAlt, setImageAlt] = useState(initial?.imageAlt ?? '');
  const [imageRemoved, setImageRemoved] = useState(false);
  const [options, setOptions] = useState<string[]>(
    initial?.options.length ? initial.options : ['', '', '', ''],
  );
  const [correct, setCorrect] = useState<number[]>(initial?.correctOptions ?? []);
  const [explanation, setExplanation] = useState(initial?.explanation ?? '');
  const [rubric, setRubric] = useState(initial?.rubric ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');

  // With a plan, marks come from it. Editing a question of the same type keeps the marks it has.
  const marksNow = plan
    ? initial && initial.type === type
      ? initial.marks
      : planMarksFor(plan, type)
    : (initial?.marks ?? DEFAULT_MARKS);
  const isChoice = type === 'SINGLE' || type === 'MULTI';
  const hasImage = Boolean(file || (!imageRemoved && initial?.imageAlt));

  // Which way the type-specific card slides in: towards the chip that was picked.
  const [slide, setSlide] = useState<'fwd' | 'back'>('fwd');
  function changeType(next: Kind) {
    if (next === type) return;
    setSlide(allowed.indexOf(next) > allowed.indexOf(type) ? 'fwd' : 'back');
    setType(next);
    // A single-answer question keeps at most one correct option.
    if (next === 'SINGLE') setCorrect((c) => c.slice(0, 1));
  }

  function toggleCorrect(i: number) {
    if (type === 'SINGLE') setCorrect([i]);
    else setCorrect((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));
  }

  function removeOption(i: number) {
    setOptions((o) => o.filter((_, idx) => idx !== i));
    // Re-point the correct answers at the shifted option indexes.
    setCorrect((c) => c.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
  }

  /** Reads the form as the API wants it, or says what is wrong. */
  function build() {
    const common = {
      type,
      body,
      markdown,
      imageAlt: hasImage ? imageAlt : imageRemoved ? null : undefined,
      marks: marksNow,
      explanation: explanation || null,
    };
    const candidate = isChoice
      ? {
          ...common,
          options: options.map((o) => o.trim()),
          correctOptions: correct,
          partialCredit: type === 'MULTI',
        }
      : { ...common, rubric: rubric || null };
    return validate(questionInputSchema, candidate);
  }

  // ---- autosave: a valid question is stored shortly after the last change ----
  const [saveState, setSaveState] = useState<{
    kind: 'idle' | 'saving' | 'saved' | 'invalid' | 'error';
    text?: string;
  }>({ kind: 'idle' });
  const savedId = useRef<string | undefined>(initial?.id);
  const lastKey = useRef<string | null>(null);
  const sentFile = useRef<File | undefined>(undefined);
  const seq = useRef(0);
  const touched = useRef(false);
  const saveFn = useRef(onSave);
  saveFn.current = onSave;
  const buildRef = useRef(build);
  buildRef.current = build;
  const fileRef = useRef(file);
  fileRef.current = file;

  /** Saves now if the form is valid and changed. Resolves true when nothing is left unsaved. */
  async function flush(): Promise<boolean> {
    const result = buildRef.current();
    if (!result.ok) {
      if (touched.current) {
        setErrors(result.errors);
        setSaveState({ kind: 'invalid', text: 'fix the highlighted fields' });
      }
      return !touched.current && !savedId.current;
    }
    const chosen = fileRef.current;
    const key = JSON.stringify(result.data) + (chosen ? `|${chosen.name}|${chosen.size}` : '');
    if (key === lastKey.current) return true;
    const mine = ++seq.current;
    setSaveState({ kind: 'saving' });
    try {
      let payload: unknown = result.data;
      // The image is only sent when it is new; later saves keep the stored one.
      if (chosen && chosen !== sentFile.current) {
        const form = new FormData();
        form.append('question', JSON.stringify(result.data));
        form.append('file', chosen);
        payload = form;
      }
      const id = await saveFn.current(payload, savedId.current);
      if (chosen) sentFile.current = chosen;
      savedId.current = id;
      if (mine === seq.current) {
        lastKey.current = key;
        setErrors({});
        setMessage('');
        setSaveState({ kind: 'saved' });
      }
      return true;
    } catch (err) {
      if (mine === seq.current) {
        const d = describeError(err);
        setErrors(d.fields);
        setSaveState({ kind: 'error', text: d.message });
      }
      return false;
    }
  }

  // Remember the starting point so saving an unchanged question does nothing.
  useEffect(() => {
    const r = build();
    lastKey.current = initial && r.ok ? JSON.stringify(r.data) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Save question: stores it, then closes the editor. Shows what is wrong when it cannot. */
  async function done() {
    touched.current = true;
    if (await flush()) onDone();
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="q-item qe" noValidate>
      {message && <Alert>{message}</Alert>}

      <section className="qe-sec">
        <div className="qe-head">
          <h3>Question type</h3>
          <span className="qe-marks">
            {marksNow} mark{marksNow === 1 ? '' : 's'}
          </span>
        </div>
        <div className="qe-types" role="radiogroup" aria-label="Question type">
          {allowed.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={type === k}
              className={`qe-type${type === k ? ' on' : ''}`}
              onClick={() => changeType(k)}
            >
              {QUESTION_TYPE_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="qe-note">
          {plan
            ? `Marks come from the paper plan for ${QUESTION_TYPE_LABELS[type]}.`
            : 'This exam has no paper plan yet, so the default marks are used. Set them in the Paper plan step.'}
        </p>
      </section>

      <section className="qe-sec">
        <div className="qe-head">
          <h3>
            Question
            <Req />
          </h3>
          <label className="qe-switch">
            <input
              type="checkbox"
              checked={markdown}
              onChange={(e) => setMarkdown(e.target.checked)}
            />
            <span className="qe-track" aria-hidden="true" />
            Formatting
          </label>
        </div>
        <textarea
          className="qe-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          placeholder="Type the question here"
          aria-label="Question"
          aria-invalid={errors.body ? true : undefined}
        />
        {errors.body && <small className="error-text">{errors.body}</small>}
        {markdown && (
          <small className="muted">
            Use <code>**bold**</code>, <code>{'`code`'}</code>, <code>{'```'}</code> on separate
            lines for code blocks, <code>{'\\(x^2\\)'}</code> for inline math, or{' '}
            <code>{'\\[x^2\\]'}</code> for display math. Formatting also applies to options,
            explanations and marking guidance.
          </small>
        )}

        <label className="qe-drop">
          <Icon name="upload" size={18} />
          <span>
            <b>{hasImage ? 'Replace image' : 'Add an image'}</b>
            <small>PNG or JPEG, up to 512 KB (optional)</small>
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = '';
              if (!chosen) return;
              if (chosen.size > 512 * 1024) {
                setMessage('The question image must be 512 KB or smaller.');
                return;
              }
              setMessage('');
              setFile(chosen);
              setImageRemoved(false);
            }}
          />
        </label>
        {hasImage && (
          <div className="qe-image">
            <label className="field">
              <span>
                Image description
                <Req />
              </span>
              <input
                value={imageAlt}
                maxLength={300}
                onChange={(e) => setImageAlt(e.target.value)}
                placeholder="Describe the image for students who cannot see it"
              />
              {errors.imageAlt && (
                <small className="error-text">Describe the question image.</small>
              )}
            </label>
            <div className="qe-image-row">
              {file && <small className="muted">{file.name}</small>}
              <Button
                type="button"
                variant="secondary"
                small
                onClick={() => {
                  setFile(undefined);
                  setImageAlt('');
                  setImageRemoved(Boolean(initial?.imageAlt));
                }}
              >
                Remove image
              </Button>
            </div>
          </div>
        )}
        {(markdown || hasImage) && (
          <div className="q-body qe-preview">
            <strong>Preview</strong>
            <div>
              <QuestionText markdown={markdown} text={body} />
            </div>
            {hasImage && (
              <QuestionImage
                path={`/exams/${examId}/questions/${initial?.id}/image`}
                alt={imageAlt || 'Question image preview'}
                preview={file}
              />
            )}
          </div>
        )}
      </section>

      <div key={type} className={`qe-swap ${slide}`}>
        {isChoice && (
          <section className="qe-sec">
            <div className="qe-head">
              <h3>
                Options
                <Req />
              </h3>
              <span className="qe-note">
                Mark the correct {type === 'SINGLE' ? 'answer' : 'answers'}
              </span>
            </div>
            <div className="qe-opts">
              {options.map((opt, i) => {
                const letter = String.fromCharCode(65 + i);
                const on = correct.includes(i);
                return (
                  <div className={`qe-opt${on ? ' correct' : ''}`} key={i}>
                    <label className="qe-pick" title="Mark as correct">
                      <input
                        type={type === 'SINGLE' ? 'radio' : 'checkbox'}
                        name="correct"
                        checked={on}
                        onChange={() => toggleCorrect(i)}
                        aria-label={`Option ${letter} is correct`}
                      />
                      <span className="qe-letter" aria-hidden="true">
                        {on ? <Icon name="check" size={16} /> : letter}
                      </span>
                    </label>
                    <input
                      className="qe-opt-input"
                      value={opt}
                      onChange={(e) =>
                        setOptions((o) => o.map((x, idx) => (idx === i ? e.target.value : x)))
                      }
                      placeholder={`Option ${letter}`}
                      maxLength={1000}
                    />
                    <button
                      type="button"
                      className="qe-remove"
                      disabled={options.length <= 2}
                      onClick={() => removeOption(i)}
                      aria-label={`Remove option ${letter}`}
                      title="Remove option"
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            {errors.options && <small className="error-text">{errors.options}</small>}
            {errors.correctOptions && <small className="error-text">{errors.correctOptions}</small>}
            {options.length < 6 && (
              <button
                type="button"
                className="qe-add"
                onClick={() => setOptions((o) => [...o, ''])}
              >
                <Icon name="plus" size={16} /> Add option
              </button>
            )}
            {type === 'MULTI' && (
              <p className="qe-note">
                Partial marks are given automatically: a student who picks only some of the correct
                options (and none wrong) gets a share of the marks.
              </p>
            )}
          </section>
        )}

        {type === 'SUBJECTIVE' && (
          <section className="qe-sec">
            <div className="qe-head">
              <h3>Marking guidance</h3>
              <span className="qe-note">For you only. Students never see this.</span>
            </div>
            <textarea
              className="qe-area"
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              maxLength={3000}
              placeholder="What a good answer should include"
              aria-label="Marking guidance"
            />
          </section>
        )}
      </div>

      <section className="qe-sec">
        <div className="qe-head">
          <h3>Explanation</h3>
          <span className="qe-note">Shown to students after results</span>
        </div>
        <textarea
          className="qe-area"
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          maxLength={3000}
          placeholder="Why the answer is correct (optional)"
          aria-label="Explanation"
        />
      </section>

      <div className="qe-actions">
        <Button type="button" loading={saveState.kind === 'saving'} onClick={() => void done()}>
          Save question
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        {saveState.kind === 'invalid' && (
          <span className="error-text" role="status">
            Not saved yet: {saveState.text}
          </span>
        )}
        {saveState.kind === 'error' && (
          <span className="error-text" role="status">
            Could not save: {saveState.text}
          </span>
        )}
      </div>
    </form>
  );
}
