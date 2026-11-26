'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AdminExamRowDto, PageDto } from '@parakh/shared';
import { Alert, StatusBadge, describeError } from '../ui';
import { api } from '../../lib/api';
import { SearchField } from '../search-field';
import { examWindow, initials } from './format';
import { Pager } from './pager';

export function Exams() {
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
