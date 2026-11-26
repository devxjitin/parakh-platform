'use client';

import { useEffect, useState } from 'react';
import { type ExamDetailDto } from '@parakh/shared';
import { Alert, Button, describeError } from '../ui';
import { api, apiBlob } from '../../lib/api';

export function LogoTab({
  exam,
  reload,
  locked,
}: {
  exam: ExamDetailDto;
  reload: () => Promise<void>;
  locked: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    if (exam.hasLogo) {
      apiBlob(`/exams/${exam.id}/logo`)
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [exam.id, exam.hasLogo, exam.updatedAt]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError('');
    if (file.size > 512 * 1024) return setError('The logo must be 512 KB or smaller.');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/exams/${exam.id}/logo`, { method: 'PUT', body: form });
      await reload();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Your logo appears on the certificates for this exam, next to the NandiVex Technologies logo.
        Use a PNG or JPEG, up to 512 KB.
      </p>
      {error && <Alert>{error}</Alert>}
      {url && <img className="logo-preview" src={url} alt="Exam logo" />}
      {!exam.hasLogo && <p className="muted">No logo yet.</p>}
      {!locked && (
        <div className="toolbar">
          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            {busy ? 'Uploading…' : exam.hasLogo ? 'Replace logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg"
              hidden
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {exam.hasLogo && (
            <Button
              variant="danger"
              onClick={() => api(`/exams/${exam.id}/logo`, { method: 'DELETE' }).then(reload)}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
