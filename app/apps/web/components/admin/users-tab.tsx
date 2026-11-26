'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, StatusBadge, describeError } from '../ui';
import { api } from '../../lib/api';
import { confirmDialog } from '../dialogs';
import { SearchField } from '../search-field';
import { Pager } from './pager';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'STUDENT' | 'EXAMINER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  emailVerifiedAt: string | null;
  createdAt: string;
}

export function Users({ selfId }: { selfId: string }) {
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
                    <td style={{ textTransform: 'capitalize' }}>
                      {u.role === 'EXAMINER' ? 'trainer' : u.role.toLowerCase()}
                    </td>
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
