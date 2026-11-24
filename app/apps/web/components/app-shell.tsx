'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { Icon, type IconName } from './icons';

/** Brand mark + wordmark. */
export function Brand({ compact, light }: { compact?: boolean; light?: boolean }) {
  return (
    <Link href="/" className={`brand${light ? ' brand-light' : ''}`}>
      <span className="brand-mark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/nandivex-logo.png" alt="NandiVex Technologies" width={34} height={34} />
      </span>
      {!compact && (
        <span className="brand-text">
          <b>
            Par<span>akh</span>
          </b>
          <small>NandiVex Technologies</small>
        </span>
      )}
    </Link>
  );
}

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Section heading shown above this item's group. */
  group?: string;
  /** An admin console tab: the link opens /admin/ on that tab. */
  tab?: string;
}

/** Fired when a sidebar link picks an admin console tab while the console is already open. */
export const ADMIN_TAB_EVENT = 'parakh:admin-tab';

function navFor(role: string): NavItem[] {
  const home: NavItem = { href: '/dashboard/', label: 'Home', icon: 'home', group: 'Menu' };
  if (role === 'EXAMINER') {
    return [
      home,
      { href: '/exams/', label: 'Exams', icon: 'exams' },
      { href: '/earnings/', label: 'Earnings', icon: 'trending' },
      { href: '/payments/', label: 'My payments', icon: 'wallet' },
    ];
  }
  return [
    home,
    {
      href: '/admin/?tab=overview',
      label: 'Overview',
      icon: 'layers',
      tab: 'overview',
      group: 'Console',
    },
    { href: '/admin/?tab=trainers', label: 'Trainers', icon: 'graduation', tab: 'trainers' },
    { href: '/admin/?tab=exams', label: 'Exams', icon: 'exams', tab: 'exams' },
    { href: '/admin/?tab=users', label: 'Users', icon: 'users', tab: 'users' },
    { href: '/admin/?tab=audit', label: 'Audit log', icon: 'fingerprint', tab: 'audit' },
    { href: '/admin/?tab=settings', label: 'Settings', icon: 'shield', tab: 'settings' },
    { href: '/admin/payouts/', label: 'Payouts', icon: 'wallet', group: 'Money' },
    { href: '/admin/payments/', label: 'Payments', icon: 'card' },
    { href: '/admin/certificates/', label: 'Certificates', icon: 'award' },
    { href: '/exams/', label: 'All exams', icon: 'exams', group: 'Browse' },
  ];
}

/** The legal pages (the same links as the public footer, see LEGAL_LINKS in legal.tsx). */
const LEGAL_NAV: { href: string; label: string }[] = [
  { href: '/terms/', label: 'Terms' },
  { href: '/privacy/', label: 'Privacy' },
  { href: '/refund-policy/', label: 'Refund policy' },
  { href: '/contact/', label: 'Contact' },
];

const CRUMBS: Record<string, string> = {
  dashboard: 'Home',
  practice: 'Practice',
  exams: 'Exams',
  new: 'New exam',
  edit: 'Edit exam',
  preview: 'Preview',
  join: 'Join an exam',
  profile: 'Profile',
  grade: 'Grade attempt',
  result: 'Result',
  admin: 'Admin',
  payouts: 'Payouts',
  payments: 'Payments',
  earnings: 'Earnings',
  certificates: 'Certificates',
  verify: 'Verify',
};

const ROLE_SHORT: Record<string, string> = {
  EXAMINER: 'Trainer',
  ADMIN: 'Admin',
};

// Every page renders its own AppShell, so the shell is rebuilt on each route change. The collapsed
// state lives here (and in localStorage) so it is not lost when the trainer or admin changes tab.
let sidebarCollapsed = false;
let sidebarRestored = false;
const SIDEBAR_KEY = 'parakh.sidebar';

export function AppShell({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  const { user, logout } = useAuth();
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(sidebarCollapsed);
  // True for the first frames after a full page load that restores a collapsed sidebar, so it does
  // not animate shut on load.
  const [instant, setInstant] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Which admin console tab is open, read from the address (and kept in step by the console).
  const [adminTab, setAdminTab] = useState('overview');
  const footRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const read = () =>
      setAdminTab(new URLSearchParams(window.location.search).get('tab') ?? 'overview');
    read();
    const onTab = (e: Event) => setAdminTab((e as CustomEvent<string>).detail);
    window.addEventListener(ADMIN_TAB_EVENT, onTab);
    return () => window.removeEventListener(ADMIN_TAB_EVENT, onTab);
  }, [pathname]);

  // After a full reload, bring back the last choice (client-side route changes already keep it).
  useEffect(() => {
    if (sidebarRestored) return;
    sidebarRestored = true;
    try {
      if (window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed' && !sidebarCollapsed) {
        sidebarCollapsed = true;
        setInstant(true);
        setCollapsed(true);
        requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
      }
    } catch {
      /* private mode: the choice is just not remembered */
    }
  }, []);

  function toggleCollapsed() {
    const next = !sidebarCollapsed;
    sidebarCollapsed = next;
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
    } catch {
      /* not remembered */
    }
  }

  // The account menu closes on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!footRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const items = user ? navFor(user.role) : [];
  const segments = pathname.split('/').filter(Boolean);
  const crumbs = segments.map((s) => CRUMBS[s] ?? s);
  const initial = (user?.name ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div
      className={`app${collapsed ? ' app-collapsed' : ''}${open ? ' app-open' : ''}${instant ? ' app-instant' : ''}`}
    >
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-head">
          <Brand />
        </div>
        <nav className="nav">
          {items.map((item, i) => {
            const onConsole = pathname === '/admin' || pathname === '/admin/';
            const active = item.tab
              ? onConsole && adminTab === item.tab
              : pathname === item.href.slice(0, -1) ||
                pathname === item.href ||
                (item.href !== '/dashboard/' && pathname.startsWith(item.href.slice(0, -1) + '/'));
            return (
              <div className="nav-group" key={item.href}>
                {item.group && <div className="nav-label">{item.group}</div>}
                <Link
                  href={item.href}
                  className={`nav-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  title={item.label}
                  style={{ ['--i' as string]: i }}
                  onClick={(e) => {
                    // Already on the console: switch tab in place, no page load.
                    if (item.tab && onConsole) {
                      e.preventDefault();
                      window.history.replaceState(null, '', `?tab=${item.tab}`);
                      setAdminTab(item.tab);
                      window.dispatchEvent(new CustomEvent(ADMIN_TAB_EVENT, { detail: item.tab }));
                    }
                  }}
                >
                  <span className="nav-ico">
                    <Icon name={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>
        {user && (
          // Profile and Sign out are in the account menu at the top right.
          <div className="sidebar-foot">
            <div className="foot-legal">
              {LEGAL_NAV.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`foot-link${pathname.startsWith(l.href.slice(0, -1)) ? ' active' : ''}`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <small className="foot-copy">© NandiVex Technologies</small>
          </div>
        )}
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="app-main">
        <header className="appbar">
          <button
            type="button"
            className="icon-btn"
            aria-label="Toggle navigation"
            onClick={() => {
              if (window.matchMedia('(max-width: 900px)').matches) setOpen((v) => !v);
              else toggleCollapsed();
            }}
          >
            <Icon name="panel" />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>Parakh</span>
            {crumbs.map((c, i) => (
              <span key={i} className={i === crumbs.length - 1 ? 'crumb-current' : undefined}>
                <Icon name="chevron" size={14} />
                {c}
              </span>
            ))}
          </nav>
          <span className="spacer" />
          {user && (
            <div className="appbar-user" ref={footRef}>
              <button
                type="button"
                className="user-chip"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <span className="avatar">{initial}</span>
                <span className="user-meta">
                  <strong>{user.name}</strong>
                  <small>{ROLE_SHORT[user.role] ?? user.role}</small>
                </span>
                <span className={`user-caret${menuOpen ? ' open' : ''}`}>
                  <Icon name="chevron" size={14} />
                </span>
              </button>
              {menuOpen && (
                <div className="user-menu" role="menu" aria-label="Account">
                  <div className="user-menu-head">
                    <span className="avatar avatar-lg">{initial}</span>
                    <span className="user-menu-who">
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                      <em>{ROLE_SHORT[user.role] ?? user.role}</em>
                    </span>
                  </div>
                  <Link href="/profile/" className="user-menu-item" role="menuitem">
                    <Icon name="user" size={16} />
                    <span>Profile</span>
                  </Link>
                  <button
                    type="button"
                    className="user-menu-item user-menu-danger"
                    role="menuitem"
                    onClick={() => logout().then(() => (window.location.href = '/login/'))}
                  >
                    <Icon name="logout" size={16} />
                    <span>Sign out</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </header>
        <main className={narrow ? 'content content-narrow' : 'content'}>{children}</main>
      </div>
    </div>
  );
}
