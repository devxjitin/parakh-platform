'use client';

import { Fragment, useEffect, useState } from 'react';
import type { TrainerCollectionRowDto, TrainerCollectionsDto } from '@parakh/shared';
import { Alert, StatCard, StatusBadge, describeError } from '../ui';
import { api } from '../../lib/api';
import { SearchField } from '../search-field';
import { rupees, initials } from './format';
import { Pager } from './pager';

export function Trainers() {
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
