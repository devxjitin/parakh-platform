'use client';

import { useState } from 'react';
import type { AuthResponse, PublicUser } from '@parakh/shared';
import { changePasswordSchema, updateProfileSchema } from '@parakh/shared';
import {
  Alert,
  Button,
  Card,
  Field,
  FieldErrors,
  PageHeader,
  Shell,
  describeError,
  validate,
} from '../../components/ui';
import { MyDataPanel } from '../../components/my-data-panel';
import { api } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';

export default function ProfilePage() {
  const { user, loading, setUser, setSession, logout } = useRequireAuth();
  const [profileErrors, setProfileErrors] = useState<FieldErrors>({});
  const [profileMsg, setProfileMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [pwErrors, setPwErrors] = useState<FieldErrors>({});
  const [pwMsg, setPwMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  if (loading || !user) {
    return (
      <Shell>
        <p className="muted">Loading…</p>
      </Shell>
    );
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input: Record<string, unknown> = {
      name: form.get('name'),
      phone: String(form.get('phone') ?? '').trim() || null,
    };
    if (user!.role === 'EXAMINER') input.orgName = String(form.get('orgName') ?? '').trim() || null;
    const result = validate(updateProfileSchema, input);
    if (!result.ok) {
      setProfileErrors(result.errors);
      return;
    }
    setProfileErrors({});
    try {
      setUser(await api<PublicUser>('/users/me', { method: 'PATCH', body: result.data }));
      setProfileMsg({ kind: 'success', text: 'Profile saved.' });
    } catch (err) {
      setProfileMsg({ kind: 'error', text: describeError(err).message });
    }
  }

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const result = validate(changePasswordSchema, {
      currentPassword: form.get('currentPassword'),
      newPassword: form.get('newPassword'),
    });
    if (!result.ok) {
      setPwErrors(result.errors);
      return;
    }
    setPwErrors({});
    try {
      const session = await api<AuthResponse>('/users/me/change-password', {
        method: 'POST',
        body: result.data,
      });
      setSession(session);
      formEl.reset();
      setPwMsg({ kind: 'success', text: 'Password changed. Other devices were signed out.' });
    } catch (err) {
      setPwMsg({ kind: 'error', text: describeError(err).message });
    }
  }

  return (
    <Shell wide>
      <PageHeader title="Profile" subtitle="Your details and password." />
      <div className="two-eq">
        <Card title="Your profile" subtitle={user.email}>
          <form onSubmit={saveProfile} noValidate>
            <Field
              label="Full name"
              required
              name="name"
              defaultValue={user.name}
              error={profileErrors.name}
            />
            <Field
              label="Phone"
              name="phone"
              type="tel"
              defaultValue={user.phone ?? ''}
              error={profileErrors.phone}
            />
            {user.role === 'EXAMINER' && (
              <Field
                label="Organisation"
                name="orgName"
                defaultValue={user.orgName ?? ''}
                error={profileErrors.orgName}
              />
            )}
            {profileMsg && <Alert kind={profileMsg.kind}>{profileMsg.text}</Alert>}
            <Button type="submit">Save changes</Button>
          </form>
        </Card>

        <Card title="Change password">
          <form onSubmit={changePassword} noValidate>
            <Field
              label="Current password"
              required
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              error={pwErrors.currentPassword}
            />
            <Field
              label="New password"
              required
              name="newPassword"
              type="password"
              autoComplete="new-password"
              hint="At least 10 characters, with a letter and a number."
              error={pwErrors.newPassword}
            />
            {pwMsg && <Alert kind={pwMsg.kind}>{pwMsg.text}</Alert>}
            <Button type="submit">Change password</Button>
          </form>
        </Card>
      </div>
      <MyDataPanel
        canClose={user.role !== 'ADMIN'}
        onClosed={() => logout().then(() => (window.location.href = '/'))}
      />
    </Shell>
  );
}
