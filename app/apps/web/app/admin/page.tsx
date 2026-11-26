'use client';

import { useEffect, useState } from 'react';
import { Alert, PageHeader, Shell } from '../../components/ui';
import { useRequireAuth } from '../../lib/auth';
import { ADMIN_TAB_EVENT } from '../../components/app-shell';
import { Overview } from '../../components/admin/overview-tab';
import { Trainers } from '../../components/admin/trainers-tab';
import { Exams } from '../../components/admin/exams-tab';
import { Users } from '../../components/admin/users-tab';
import { Audit } from '../../components/admin/audit-tab';
import { Settings } from '../../components/admin/settings-tab';

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
  // The tabs live in the sidebar now; it changes `?tab=` and fires ADMIN_TAB_EVENT.
  useEffect(() => {
    const read = () => {
      const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
      setTab(t && TABS.some((x) => x.key === t) ? t : 'overview');
    };
    read();
    window.addEventListener(ADMIN_TAB_EVENT, read);
    return () => window.removeEventListener(ADMIN_TAB_EVENT, read);
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
