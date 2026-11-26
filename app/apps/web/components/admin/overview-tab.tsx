'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminOverviewDto, MonthlyReportDto, SeriesPointDto } from '@parakh/shared';
import { Alert, StatCard, describeError } from '../ui';
import { api } from '../../lib/api';
import { COPY } from '../../lib/copy';
import { rupees } from './format';
import { thisMonth } from './format';

export function Overview() {
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
            <div className="toolbar" style={{ marginTop: 12 }}>
              <Link className="btn btn-secondary btn-link" href="/admin/payouts/">
                Payouts
              </Link>
              <Link className="btn btn-secondary btn-link" href="/admin/payments/">
                {COPY.payments}
              </Link>
              <Link className="btn btn-secondary btn-link" href="/admin/certificates/">
                Certificates
              </Link>
            </div>
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
