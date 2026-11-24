'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import type {
  AdminExamRowDto,
  AdminOverviewDto,
  AuditRowDto,
  MonthlyReportDto,
  PageDto,
  PlatformSettings,
  SeriesPointDto,
  TrainerCollectionRowDto,
  TrainerCollectionsDto,
} from '@parakh/shared';
import {
  Alert,
  Button,
  PageHeader,
  Shell,
  StatCard,
  StatusBadge,
  describeError,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { confirmDialog } from '../../components/dialogs';
import { SearchField } from '../../components/search-field';
import { ADMIN_TAB_EVENT } from '../../components/app-shell';

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString();

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

/** "24 Nov 2026" over "8:20 am to 9:20 am" (or both dates when the exam spans days). */
function examWindow(startsAt: string | null, endsAt: string | null) {
  if (!startsAt) return { top: 'No start set', bottom: '' };
  const s = new Date(startsAt);
  if (!endsAt) return { top: dayFmt.format(s), bottom: `from ${timeFmt.format(s)}` };
  const e = new Date(endsAt);
  if (dayFmt.format(s) === dayFmt.format(e)) {
    return { top: dayFmt.format(s), bottom: `${timeFmt.format(s)} – ${timeFmt.format(e)}` };
  }
  return {
    top: `${dayFmt.format(s)}, ${timeFmt.format(s)}`,
    bottom: `to ${dayFmt.format(e)}, ${timeFmt.format(e)}`,
  };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

type Tab = 'overview' | 'trainers' | 'exams' | 'users' | 'audit' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'trainers', label: 'Trainers' },
  { key: 'exams', label: 'Exams' },
  { key: 'users', label: 'Users' },
  { key: 'audit', label: 'Audit log' },
  { key: 'settings', label: 'Settings' },
];

export default function AdminConsolePage() {
  const { user, loading } = useRequireAuth();
  const [tab, setTab] = useState<Tab>('overview');

  // Remember the tab in the address, so a refresh stays where you were.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && TABS.some((x) => x.key === t)) setTab(t);
  }, []);
  // The sidebar can pick a tab too; follow it.
  useEffect(() => {
    const onTab = (e: Event) => {
      const t = (e as CustomEvent<string>).detail as Tab;
      if (TABS.some((x) => x.key === t)) setTab(t);
    };
    window.addEventListener(ADMIN_TAB_EVENT, onTab);
    return () => window.removeEventListener(ADMIN_TAB_EVENT, onTab);
  }, []);

  if (loading || !user) {
    return (
      <Shell wide>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }
  if (user.role !== 'ADMIN') {
    return (
      <Shell wide>
        <Alert>This page is for NandiVex Technologies staff.</Alert>
      </Shell>
    );
  }

  return (
    <Shell wide>
      <PageHeader title="Admin console" subtitle="Run Parakh: money, people, exams and settings" />
      {tab === 'overview' && <Overview />}
      {tab === 'trainers' && <Trainers />}
      {tab === 'exams' && <Exams />}
      {tab === 'users' && <Users selfId={user.id} />}
      {tab === 'audit' && <Audit />}
      {tab === 'settings' && <Settings />}
    </Shell>
  );
}

// ------------------------------------------------------------------ overview

function thisMonth(): string {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function Overview() {
  const [o, setO] = useState<AdminOverviewDto | null>(null);
  const [month, setMonth] = useState(thisMonth());
  const [report, setReport] = useState<MonthlyReportDto | null>(null);
  const [series, setSeries] = useState<SeriesPointDto[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<AdminOverviewDto>('/admin/overview'),
      api<SeriesPointDto[]>('/admin/reports/series?months=12'),
    ])
      .then(([a, b]) => {
        setO(a);
        setSeries(b);
      })
      .catch((e) => setError(describeError(e).message));
  }, []);
  useEffect(() => {
    api<MonthlyReportDto>(`/admin/reports/monthly?month=${month}`)
      .then(setReport)
      .catch((e) => setError(describeError(e).message));
  }, [month]);

  const max = Math.max(1, ...series.map((s) => s.grossPaise));
  return (
    <div className="stack">
      {error && <Alert>{error}</Alert>}
      {o && !o.ledgerBalanced && (
        <Alert>The ledger does not add up to zero. Stop payouts and check the Payments page.</Alert>
      )}
      {o && (
        <div className="stats">
          <StatCard
            label="Users"
            value={o.users.students + o.users.examiners}
            note={`${o.users.examiners} trainers, ${o.users.students} students${o.users.suspended ? `, ${o.users.suspended} suspended` : ''}`}
            icon="user"
          />
          <StatCard
            label="Exams"
            value={o.exams.total}
            note={`${o.exams.live} open, ${o.exams.awaitingResults} awaiting results`}
            icon="exams"
          />
          <StatCard label="Joins" value={o.enrollments} note="paid or sponsored" icon="join" />
          <StatCard
            label="Waiting for you"
            value={o.waiting.payoutRequests + o.waiting.certificates}
            note={`${o.waiting.payoutRequests} payout requests, ${o.waiting.certificates} certificates`}
            icon="check"
          />
        </div>
      )}

      <section className="card">
        <div className="toolbar">
          <h2 style={{ margin: 0 }}>Money in a month</h2>
          <span className="spacer" />
          <input
            type="month"
            value={month}
            max={thisMonth()}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            aria-label="Month"
          />
        </div>
        {report && (
          <>
            <div className="stats" style={{ marginTop: 12 }}>
              <StatCard
                label="NandiVex Technologies earned"
                value={rupees(report.platformRevenuePaise)}
                note="after refunds"
                icon="zap"
                highlight
              />
              <StatCard
                label="Owed to trainers"
                value={rupees(report.owedAtMonthEndPaise)}
                note={`at the end of ${month}`}
                icon="shield"
              />
              <StatCard
                label="Payable right now"
                value={rupees(report.payableNowPaise)}
                note="results published, not yet paid"
                icon="check"
              />
              <StatCard
                label="Money received"
                value={rupees(report.grossPaise)}
                note={`${rupees(report.refundedPaise)} refunded`}
                icon="book"
              />
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              Trainers earned {rupees(report.examinerEarnedPaise)} this month; NandiVex Technologies
              paid out {rupees(report.paidOutPaise)}. Months follow India time.
            </p>
            <h3>Owed to trainers</h3>
            {report.examiners.length === 0 ? (
              <p className="muted">No trainer activity in this month.</p>
            ) : (
              <div className="table-wrap admin-table">
                <table>
                  <thead>
                    <tr>
                      <th>Trainer</th>
                      <th>Earned this month</th>
                      <th>Paid out</th>
                      <th>Owed at month end</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.examiners.map((x) => (
                      <tr key={x.examinerId}>
                        <td>
                          {x.name}
                          <div className="muted">{x.email}</div>
                        </td>
                        <td>{rupees(x.earnedPaise)}</td>
                        <td>{rupees(x.paidOutPaise)}</td>
                        <td>
                          <strong>{rupees(x.owedAtMonthEndPaise)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Last 12 months</h2>
        <div className="table-wrap admin-table">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Received</th>
                <th>NandiVex Technologies earned</th>
                <th>Trainers earned</th>
                <th>Refunded</th>
                <th>Paid out</th>
                <th style={{ width: '20%' }} />
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((s) => (
                <tr key={s.month}>
                  <td>{s.month}</td>
                  <td>{rupees(s.grossPaise)}</td>
                  <td>{rupees(s.platformRevenuePaise)}</td>
                  <td>{rupees(s.examinerEarnedPaise)}</td>
                  <td>{rupees(s.refundedPaise)}</td>
                  <td>{rupees(s.paidOutPaise)}</td>
                  <td>
                    <div
                      aria-hidden
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: 'var(--primary)',
                        width: `${Math.max(2, (s.grossPaise / max) * 100)}%`,
                        opacity: s.grossPaise ? 1 : 0.15,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// --------------------------------------------------------------------- lists

function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="toolbar" style={{ marginTop: 12 }}>
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="muted">
        Page {page} of {pages}, {total} total
      </span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}

function Trainers() {
  const [data, setData] = useState<TrainerCollectionsDto | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (q.trim()) p.set('q', q.trim());
    api<TrainerCollectionsDto>(`/admin/trainers/collections?${p}`)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(describeError(e).message));
  }, [q, page]);

  const row = (t: TrainerCollectionRowDto) => {
    const isOpen = open === t.examinerId;
    return (
      <>
        <tr className={`expandable${isOpen ? ' is-open' : ''}`}>
          <td>
            <button
              type="button"
              className="row-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : t.examinerId)}
            >
              <svg
                aria-hidden
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
              <span className="avatar" aria-hidden>
                {initials(t.name)}
              </span>
              <span className="person-text">
                <span className="cell-title">{t.name}</span>
                <span className="muted">{t.email}</span>
              </span>
            </button>
          </td>
          <td className="num">{t.payments}</td>
          <td className="num">
            <strong>{rupees(t.collectedPaise)}</strong>
            {t.refundedPaise > 0 && <div className="muted">{rupees(t.refundedPaise)} refunded</div>}
          </td>
          <td className="num">{rupees(t.shareEarnedPaise)}</td>
          <td className="num">{rupees(t.paidOutPaise)}</td>
          <td className="num">
            {rupees(t.payableNowPaise)}
            {t.accruingPaise > 0 && <div className="muted">{rupees(t.accruingPaise)} accruing</div>}
          </td>
        </tr>
        {isOpen && (
          <tr className="detail-row">
            <td colSpan={6}>
              {t.perExam.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>
                  No student payments on this trainer&apos;s exams yet.
                </p>
              ) : (
                <table className="sub-table">
                  <thead>
                    <tr>
                      <th>Exam</th>
                      <th>Status</th>
                      <th className="num">Payments</th>
                      <th className="num">Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.perExam.map((e) => (
                      <tr key={e.examId}>
                        <td>
                          <span className="cell-title">{e.title}</span>
                          {e.code && <code className="code-chip">{e.code}</code>}
                        </td>
                        <td>
                          <StatusBadge status={e.status} />
                        </td>
                        <td className="num">{e.payments}</td>
                        <td className="num">
                          {rupees(e.collectedPaise)}
                          {e.refundedPaise > 0 && (
                            <div className="muted">{rupees(e.refundedPaise)} refunded</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </td>
          </tr>
        )}
      </>
    );
  };

  return (
    <div className="stack">
      {data && (
        <div className="stats">
          <StatCard
            label="Collected for trainers"
            value={rupees(data.totals.collectedPaise)}
            note="student payments on this page, after refunds"
            icon="zap"
            highlight
          />
          <StatCard
            label="Trainers' share"
            value={rupees(data.totals.shareEarnedPaise)}
            note="earned by the trainers listed"
            icon="shield"
          />
          <StatCard
            label="Paid out"
            value={rupees(data.totals.paidOutPaise)}
            note="already sent to them"
            icon="check"
          />
        </div>
      )}
      <section className="card admin-list">
        <div className="toolbar admin-filters">
          <SearchField
            placeholder="Search trainer name or email"
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
              setOpen(null);
            }}
          />
          {data && <span className="muted admin-count">{data.total} trainers</span>}
        </div>
        {error && <Alert>{error}</Alert>}
        {data && (
          <>
            <div className="table-wrap admin-table">
              <table>
                <thead>
                  <tr>
                    <th>Trainer</th>
                    <th className="num">Payments</th>
                    <th className="num">Collected</th>
                    <th className="num">Their share</th>
                    <th className="num">Paid out</th>
                    <th className="num">Payable now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((t) => (
                    <Fragment key={t.examinerId}>{row(t)}</Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {data.rows.length === 0 && <p className="muted">No trainers match.</p>}
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}

function Exams() {
  const [data, setData] = useState<PageDto<AdminExamRowDto> | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (q.trim()) p.set('q', q.trim());
    if (status) p.set('status', status);
    api<PageDto<AdminExamRowDto>>(`/admin/exams?${p}`)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(describeError(e).message));
  }, [q, status, page]);
  useEffect(() => load(), [load]);

  return (
    <section className="card admin-list">
      <div className="toolbar admin-filters">
        <SearchField
          placeholder="Search title, code or trainer"
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Any status</option>
          {['DRAFT', 'PUBLISHED', 'RESULTS_FINAL', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
        {data && <span className="muted admin-count">{data.total} exams</span>}
      </div>
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <div className="table-wrap admin-table">
            <table>
              <thead>
                <tr>
                  <th>Exam</th>
                  <th>Trainer</th>
                  <th>Status</th>
                  <th className="num">Joined</th>
                  <th className="num">Attempts</th>
                  <th>Window</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((e) => {
                  const w = examWindow(e.startsAt, e.endsAt);
                  return (
                    <tr key={e.id}>
                      <td>
                        <div className="cell-title">{e.title}</div>
                        {e.code && <code className="code-chip">{e.code}</code>}
                      </td>
                      <td>
                        <div className="person">
                          <span className="avatar" aria-hidden>
                            {initials(e.trainerName)}
                          </span>
                          <span className="person-text">
                            <span className="cell-title">{e.trainerName}</span>
                            <span className="muted">{e.trainerEmail}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={e.status} />
                      </td>
                      <td className="num">{e.enrollments}</td>
                      <td className="num">{e.attempts}</td>
                      <td>
                        <div className="cell-title">{w.top}</div>
                        {w.bottom && <div className="muted">{w.bottom}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.rows.length === 0 && <p className="muted">No exams match.</p>}
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'STUDENT' | 'EXAMINER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  emailVerifiedAt: string | null;
  createdAt: string;
}

function Users({ selfId }: { selfId: string }) {
  const [data, setData] = useState<{
    total: number;
    page: number;
    pageSize: number;
    users: AdminUser[];
  } | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page) });
    if (q.trim()) p.set('q', q.trim());
    if (role) p.set('role', role);
    api<{ total: number; page: number; pageSize: number; users: AdminUser[] }>(`/admin/users?${p}`)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(describeError(e).message));
  }, [q, role, page]);
  useEffect(() => load(), [load]);

  async function act(u: AdminUser, what: 'suspend' | 'activate' | 'verify') {
    if (
      what === 'suspend' &&
      !(await confirmDialog(`Suspend ${u.email}? They are signed out at once.`, {
        title: 'Suspend user',
        confirmLabel: 'Suspend',
        danger: true,
      }))
    ) {
      return;
    }
    setBusy(u.id);
    try {
      if (what === 'verify') await api(`/admin/users/${u.id}/verify`, { method: 'PATCH' });
      else
        await api(`/admin/users/${u.id}/status`, {
          method: 'PATCH',
          body: { status: what === 'suspend' ? 'SUSPENDED' : 'ACTIVE' },
        });
      load();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="card admin-list">
      <div className="toolbar admin-filters">
        <SearchField
          placeholder="Search name or email"
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
        />
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          <option value="STUDENT">Students</option>
          <option value="EXAMINER">Trainers</option>
          <option value="ADMIN">Admins</option>
        </select>
      </div>
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <div className="table-wrap admin-table">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      <div className="muted">
                        {u.email}
                        {!u.emailVerifiedAt && ', email not verified'}
                      </div>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{u.role === 'EXAMINER' ? 'trainer' : u.role.toLowerCase()}</td>
                    <td>
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="toolbar">
                        {!u.emailVerifiedAt && (
                          <Button
                            variant="secondary"
                            loading={busy === u.id}
                            onClick={() => act(u, 'verify')}
                          >
                            Verify email
                          </Button>
                        )}
                        {u.id !== selfId &&
                          (u.status === 'ACTIVE' ? (
                            <Button
                              variant="secondary"
                              loading={busy === u.id}
                              onClick={() => act(u, 'suspend')}
                            >
                              Suspend
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              loading={busy === u.id}
                              onClick={() => act(u, 'activate')}
                            >
                              Reactivate
                            </Button>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.users.length === 0 && <p className="muted">No one matches.</p>}
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function Audit() {
  const [data, setData] = useState<PageDto<AuditRowDto> | null>(null);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (action.trim()) p.set('action', action.trim());
    api<PageDto<AuditRowDto>>(`/admin/audit?${p}`)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(describeError(e).message));
  }, [action, page]);

  return (
    <section className="card admin-list">
      <div className="toolbar admin-filters">
        <SearchField
          placeholder="Filter by action, e.g. payout, refund, settings"
          value={action}
          onChange={(v) => {
            setAction(v);
            setPage(1);
          }}
        />
      </div>
      {error && <Alert>{error}</Alert>}
      {data && (
        <>
          <div className="table-wrap admin-table">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>On</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{when(r.createdAt)}</td>
                    <td>{r.actorName ?? <span className="muted">system / visitor</span>}</td>
                    <td>
                      <code>{r.action}</code>
                    </td>
                    <td className="muted">
                      {r.entity}
                      {r.entityId ? ` ${r.entityId.slice(0, 8)}` : ''}
                    </td>
                    <td className="muted">{r.ip ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rows.length === 0 && <p className="muted">Nothing logged yet.</p>}
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ settings

function Settings() {
  const [form, setForm] = useState<Record<keyof PlatformSettings, string> | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const toForm = (s: PlatformSettings) => ({
    examCreationPaise: String(s.examCreationPaise / 100),
    examJoinPaise: String(s.examJoinPaise / 100),
    examinerSharePercent: String(s.examinerSharePercent),
    minPayoutPaise: String(s.minPayoutPaise / 100),
  });
  useEffect(() => {
    api<PlatformSettings>('/admin/settings')
      .then((s) => setForm(toForm(s)))
      .catch((e) => setError(describeError(e).message));
  }, []);

  if (!form) return error ? <Alert>{error}</Alert> : <p className="muted">Loading…</p>;

  const field = (key: keyof PlatformSettings, label: string, hint: string, unit: string) => (
    <label className="field">
      <span>
        {label} ({unit})
      </span>
      <input
        inputMode="decimal"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
      <small className="muted">{hint}</small>
    </label>
  );

  async function save() {
    if (!form) return;
    const rupeesToPaise = (v: string) => Math.round(Number(v) * 100);
    const body: PlatformSettings = {
      examCreationPaise: rupeesToPaise(form.examCreationPaise),
      examJoinPaise: rupeesToPaise(form.examJoinPaise),
      examinerSharePercent: Number(form.examinerSharePercent),
      minPayoutPaise: rupeesToPaise(form.minPayoutPaise),
    };
    if (Object.values(body).some((v) => !Number.isFinite(v))) {
      setError('Enter numbers only.');
      return;
    }
    if (
      !(await confirmDialog(
        `Publishing fee ${rupees(body.examCreationPaise)}, join fee ${rupees(body.examJoinPaise)}.\n\nThis applies to payments made from now on. Save?`,
        { title: 'Change platform fees', confirmLabel: 'Save' },
      ))
    ) {
      return;
    }
    setBusy(true);
    setError('');
    setNote('');
    try {
      setForm(toForm(await api<PlatformSettings>('/admin/settings', { method: 'PUT', body })));
      setNote('Saved. New payments use these values.');
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Prices</h2>
      <p className="muted">
        Changes apply to payments made from now on. Past payments keep what was charged, and the
        ledger is never rewritten. Every change is recorded in the audit log.
      </p>
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {field('examCreationPaise', 'Publishing fee', 'Trainers pay this to publish an exam.', '₹')}
      {field('examJoinPaise', 'Join fee', 'Students pay this to join an exam.', '₹')}
      <Button loading={busy} onClick={save}>
        Save settings
      </Button>
    </section>
  );
}
