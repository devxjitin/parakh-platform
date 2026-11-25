'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CertificateTemplate,
  type ExamDetailDto,
  type TrainerCertificatesDto,
} from '@parakh/shared';
import { api, apiBlob } from '../lib/api';
import { Alert, StatusBadge, describeError } from './ui';
import { useStepSave, type RegisterSave } from '../lib/step-save';

/** The trainer designs the exam's certificate and sees a live PDF preview. */
export function CertificatePanel({
  exam,
  reload,
  registerSave,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
  /** The page saves the design when the trainer presses Next. */
  registerSave?: RegisterSave;
}) {
  const [info, setInfo] = useState<TrainerCertificatesDto | null>(null);
  const [tpl, setTpl] = useState<CertificateTemplate | null>(null);
  const [kind, setKind] = useState<'ACHIEVEMENT' | 'PARTICIPATION' | 'TRAINER'>('ACHIEVEMENT');
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const current = useRef('');
  // The design as last stored on the server, so only a real change is saved.
  const lastSaved = useRef('');
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const load = useCallback(async () => {
    try {
      const v = await api<TrainerCertificatesDto>(`/exams/${exam.id}/certificate`);
      setInfo(v);
      setTpl(v.template);
      lastSaved.current = JSON.stringify(v.template);
    } catch (err) {
      setError(describeError(err).message);
    }
  }, [exam.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Redraw the preview shortly after each change.
  useEffect(() => {
    if (!tpl) return;
    const t = setTimeout(async () => {
      try {
        const blob = await apiBlob(`/exams/${exam.id}/certificate/preview?kind=${kind}`, {
          method: 'POST',
          body: tpl,
        });
        const url = URL.createObjectURL(blob);
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = url;
        setPreviewUrl(url);
      } catch (err) {
        setError(describeError(err).message);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [tpl, kind, exam.id]);

  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current);
    },
    [],
  );

  // Saved when the trainer presses Next (there is no Save button).
  // Once the exam is published nothing about its certificates can change.
  const locked = exam.status !== 'DRAFT';
  useStepSave(registerSave, async () => {
    if (!tpl || locked) return null;
    if (JSON.stringify(tpl) === lastSaved.current) return null;
    try {
      const v = await api<TrainerCertificatesDto>(`/exams/${exam.id}/certificate`, {
        method: 'PUT',
        body: tpl,
      });
      lastSaved.current = JSON.stringify(v.template);
      setInfo(v);
      setError('');
      await reloadRef.current();
      return null;
    } catch (err) {
      const message = describeError(err).message;
      setError(`Could not save: ${message}`);
      return message;
    }
  });

  if (!info || !tpl) return error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>;
  const set = <K extends keyof CertificateTemplate>(k: K, v: CertificateTemplate[K]) =>
    setTpl({ ...tpl, [k]: v });

  return (
    <div className="stack">
      {error && <Alert>{error}</Alert>}
      {locked ? (
        <Alert kind="info">
          This exam is published, so the certificate settings are locked.{' '}
          {info.total === 0
            ? 'No certificates were made for this exam.'
            : `${info.total} certificates: ${info.issued} issued and emailed${info.waiting ? `, ${info.waiting} waiting` : ''}${info.rejected ? `, ${info.rejected} not issued` : ''}.`}
        </Alert>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {exam.nandivexHosted
            ? 'When you publish results, each student gets a certificate with the NandiVex Technologies logo. They are emailed automatically as soon as results are published.'
            : 'When you publish results, each student gets a certificate with your logo and the NandiVex Technologies logo, and you get a Certificate of Appreciation for conducting the exam. They are emailed automatically as soon as results are published.'}
        </p>
      )}

      <div className="cert-designer">
        <div className="cert-options">
          <h3 className="cert-heading">Who gets a certificate</h3>
          <label className={`cert-option${tpl.enabled ? ' on' : ''}`}>
            <span className="cert-option-text">
              <b>Certificates for this exam</b>
              <small>Students who pass get a Certificate of Achievement.</small>
            </span>
            <input
              type="checkbox"
              className="toggle-input"
              checked={tpl.enabled}
              disabled={locked}
              onChange={(e) => set('enabled', e.target.checked)}
            />
          </label>
          {!exam.nandivexHosted && (
            <label className={`cert-option${tpl.trainerCertificate ? ' on' : ''}`}>
              <span className="cert-option-text">
                <b>Certificate of Appreciation for you</b>
                <small>A thank-you certificate for conducting this exam.</small>
              </span>
              <input
                type="checkbox"
                className="toggle-input"
                checked={tpl.trainerCertificate}
                disabled={locked || !tpl.enabled}
                onChange={(e) => set('trainerCertificate', e.target.checked)}
              />
            </label>
          )}
          <label className={`cert-option${tpl.participation ? ' on' : ''}`}>
            <span className="cert-option-text">
              <b>Certificate of Participation</b>
              <small>For students below the pass mark ({exam.passPercent}%).</small>
            </span>
            <input
              type="checkbox"
              className="toggle-input"
              checked={tpl.participation}
              disabled={locked || !tpl.enabled}
              onChange={(e) => set('participation', e.target.checked)}
            />
          </label>

          <p className="muted cert-note">
            {exam.nandivexHosted
              ? 'Every certificate has the same fixed design, colours and signature, with the NandiVex Technologies logo at the top centre.'
              : 'Every certificate has the same fixed design, colours and signature. The only thing you add is your logo: upload it in the Logo step (or set one on your account).'}
          </p>
        </div>

        <div className="cert-preview">
          <div className="cert-preview-head">
            <strong>Preview</strong>
            <StatusBadge status="PUBLISHED" label="sample" />
          </div>
          <div className="cert-kinds" role="tablist" aria-label="Certificate type">
            {(
              [
                ['ACHIEVEMENT', 'Achievement'],
                ['PARTICIPATION', 'Participation'],
                ['TRAINER', 'Appreciation'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={kind === k ? 'on' : ''}
                onClick={() => setKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {previewUrl ? (
            <iframe
              title="Certificate preview"
              src={`${previewUrl}#toolbar=0&navpanes=0`}
              className="cert-frame"
            />
          ) : (
            <p className="muted">Drawing the preview…</p>
          )}
        </div>
      </div>
    </div>
  );
}
