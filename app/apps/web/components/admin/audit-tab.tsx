'use client';

import { useEffect, useState } from 'react';
import type { AuditRowDto, PageDto } from '@parakh/shared';
import { Alert, describeError } from '../ui';
import { api } from '../../lib/api';
import { SearchField } from '../search-field';
import { when } from './format';
import { Pager } from './pager';

export function Audit() {
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
