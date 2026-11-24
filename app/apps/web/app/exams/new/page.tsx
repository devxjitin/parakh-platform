'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ExamDetailDto } from '@parakh/shared';
import { ExamSettingsForm, type ExamSettingsValues } from '../../../components/exam-settings-form';
import { ExamStepper, PAPER_STEPS } from '../../../components/exam-stepper';
import { Alert, PageHeader, Shell, describeError } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useRequireAuth } from '../../../lib/auth';

// New exam is just the Basics step. Saving creates the draft and hands over to the Edit page, which
// carries on in order: Logo → Certificate → Paper plan → Questions → Payment → Publish.

export default function NewExamPage() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (loading || !user) {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }
  if (user.role !== 'EXAMINER' && user.role !== 'ADMIN') {
    return (
      <Shell wide>
        <Alert>Only trainers and NandiVex Technologies admins can build exams.</Alert>
      </Shell>
    );
  }

  async function create(values: ExamSettingsValues) {
    setBusy(true);
    setError('');
    try {
      const exam = await api<ExamDetailDto>('/exams', { method: 'POST', body: values });
      router.push(
        `/exams/edit/?id=${exam.id}&step=${exam.nandivexHosted ? 'certificate' : 'logo'}`,
      );
    } catch (err) {
      setError(describeError(err).message);
      setBusy(false);
    }
  }

  return (
    <Shell wide>
      <PageHeader
        title="New exam"
        subtitle="Start with the basics. The rest follows step by step: certificate, paper plan, questions and publish (trainers also add a logo and choose who pays)."
      >
        <Link className="btn btn-secondary btn-link" href="/exams/">
          Back to your exams
        </Link>
      </PageHeader>

      {/* A NandiVex-run exam has no trainer logo and no creation fee, so those steps are left out. */}
      <ExamStepper
        current="basics"
        steps={
          user.role === 'ADMIN'
            ? PAPER_STEPS.filter((s) => s.key !== 'logo' && s.key !== 'payment')
            : PAPER_STEPS
        }
      />

      {error && <Alert>{error}</Alert>}
      <ExamSettingsForm
        nandivex={user.role === 'ADMIN'}
        submitLabel={
          busy ? 'Creating…' : user.role === 'ADMIN' ? 'Next: certificate' : 'Next: add your logo'
        }
        onSubmit={create}
      />
    </Shell>
  );
}
