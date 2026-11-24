'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  CERT_KIND_TITLE,
  examPhase,
  type EnrollmentDto,
  type ExamSummaryDto,
  type MyCertificateDto,
  type PracticeSummaryDto,
} from '@parakh/shared';
import { Alert, Button, PageHeader, Shell, StatCard, StatusBadge } from '../../components/ui';
import { api, apiBlob } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { confirmDialog } from '../../components/dialogs';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'STUDENT' | 'EXAMINER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  emailVerifiedAt: string | null;
  createdAt: string;
}

function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<{ total: number; users: AdminUser[] }>('/admin/users?pageSize=50');
      setUsers(data.users);
      setTotal(data.total);
    } catch {
      setError('Could not load users.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(user: AdminUser) {
    const status = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (
      status === 'SUSPENDED' &&
      !(await confirmDialog(`Suspend ${user.email}? They will be signed out immediately.`, {
        title: 'Suspend user',
        confirmLabel: 'Suspend',
        danger: true,
      }))
    )
      return;
    try {
      await api(`/admin/users/${user.id}/status`, { method: 'PATCH', body: { status } });
      await load();
    } catch {
      setError('Could not update the user.');
    }
  }

  return (
    <>
      <div className="stats">
        <StatCard label="Users" value={total} note="registered accounts" icon="users" highlight />
        <StatCard
          label="Active"
          value={users.filter((u) => u.status === 'ACTIVE').length}
          note="can sign in"
          icon="check"
        />
        <StatCard
          label="Suspended"
          value={users.filter((u) => u.status === 'SUSPENDED').length}
          note="signed out"
          icon="shield"
        />
      </div>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Users</h2>
        {error && <Alert>{error}</Alert>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className="badge">
                      {u.role === 'EXAMINER' ? 'trainer' : u.role.toLowerCase()}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td>
                    {u.id !== currentUserId && (
                      <Button
                        variant={u.status === 'ACTIVE' ? 'danger' : 'secondary'}
                        onClick={() => toggle(u)}
                      >
                        {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Certificates() {
  const [items, setItems] = useState<MyCertificateDto[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    api<MyCertificateDto[]>('/certificates/mine')
      .then(setItems)
      .catch(() => undefined);
  }, []);
  if (items.length === 0) return null;

  async function download(c: MyCertificateDto) {
    try {
      const blob = await apiBlob(`/certificates/${c.id}/pdf`);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch {
      setError('Could not open the certificate. Try again.');
    }
  }
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Your certificates</h2>
      {error && <Alert>{error}</Alert>}
      <div className="table-wrap">
        <table>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.examTitle}</strong>
                  <div className="muted">{CERT_KIND_TITLE[c.kind]}</div>
                </td>
                <td>
                  {c.state === 'ISSUED' ? (
                    <>
                      <div className="mono">{c.serialNo}</div>
                      <a href={c.verifyUrl}>Verification link</a>
                    </>
                  ) : (
                    <span className="muted">Waiting for NandiVex Technologies to approve it</span>
                  )}
                </td>
                <td>
                  {c.state === 'ISSUED' && (
                    <Button small onClick={() => download(c)}>
                      Download PDF
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function dashboardPhase(
  e: ExamSummaryDto,
  now: number,
): 'draft' | 'scheduled' | 'open' | 'conducted' {
  const phase = examPhase(e, new Date(now));
  if (phase === 'DRAFT') return 'draft';
  if (phase === 'UPCOMING') return 'scheduled';
  if (phase === 'LIVE') return 'open';
  return 'conducted';
}

function TrainerHome() {
  const [exams, setExams] = useState<ExamSummaryDto[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<ExamSummaryDto[]>('/exams')
      .then(setExams)
      .catch(() => setError('Could not load your exams.'));
  }, []);
  const list = exams ?? [];
  const now = Date.now();
  const count = (phase: ReturnType<typeof dashboardPhase>) =>
    exams ? list.filter((e) => dashboardPhase(e, now) === phase).length : 'N/A';
  return (
    <>
      <Certificates />
      <div className="stats">
        <StatCard
          label="Scheduled"
          value={count('scheduled')}
          note="upcoming exams"
          icon="schedule"
        />
        <StatCard label="Published" value={count('open')} note="open for students" icon="publish" />
        <StatCard
          label="Conducted"
          value={count('conducted')}
          note="completed exams"
          icon="conducted"
        />
        <StatCard label="Drafts" value={count('draft')} note="not published yet" icon="draft" />
      </div>
      <div className="two-col two-col-even">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Recent exams</h2>
          <p className="card-sub">Your latest work.</p>
          {error && <Alert>{error}</Alert>}
          {exams === null && !error && <p className="muted">Loading…</p>}
          {exams?.length === 0 && (
            <div className="empty">
              <strong>No exams yet</strong>
              Create an exam, add questions, then publish it to get a code to share.
            </div>
          )}
          {list.slice(0, 5).map((e) => (
            <div className="list-row" key={e.id}>
              <div>
                <strong>{e.title}</strong>
                <div className="muted">
                  {e.questionCount} questions, {e.durationMinutes} min
                </div>
              </div>
              <span className="spacer" />
              <StatusBadge status={e.status} />
              <Link
                className="btn btn-secondary btn-small btn-link"
                href={`/exams/edit/?id=${e.id}`}
              >
                Open
              </Link>
            </div>
          ))}
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Quick actions</h2>
          <p className="card-sub">Build and share exams.</p>
          <div className="actions-list">
            <Link className="btn btn-primary btn-link" href="/exams/new/">
              New exam
            </Link>
            <Link className="btn btn-secondary btn-link" href="/exams/">
              All exams
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { user, loading } = useRequireAuth();
  const router = useRouter();
  // Students have no portal: send anyone who lands here to the join page.
  useEffect(() => {
    if (user?.role === 'STUDENT') router.replace('/join/');
  }, [user, router]);

  if (loading || !user || user.role === 'STUDENT') {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }

  const first = user.name.split(' ')[0];
  const subtitle =
    user.role === 'EXAMINER'
      ? 'Here is an overview of your exams.'
      : 'Here is an overview of the platform.';

  return (
    <Shell wide>
      <PageHeader title={`Welcome back, ${first}!`} subtitle={subtitle} />
      {user.role === 'EXAMINER' && <TrainerHome />}
      {user.role === 'ADMIN' && <AdminUsers currentUserId={user.id} />}
    </Shell>
  );
}
