'use client';

import { useEffect, useState } from 'react';
import { appUrl } from '../lib/config';
import { Brand } from './brand';
import { Icon } from './icons';

const LINKS = [
  { href: '/#exams', id: 'exams', label: 'Exams' },
  { href: '/#features', id: 'features', label: 'Features' },
  { href: '/#how', id: 'how', label: 'How it works' },
  { href: '/#verify', id: 'verify', label: 'Verify' },
  { href: '/#pricing', id: 'pricing', label: 'Pricing' },
];

/** Sticky navigation bar plus footer, shared by every page of the website. */
export function LandingFrame({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  // Which section is on screen, so its link in the bar is highlighted.
  const [active, setActive] = useState('home');
  // The links collapse into a menu on small screens.
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8);
      if (window.location.pathname !== '/') return setActive('');
      // The last section whose top has passed a line a third of the way down the screen.
      const line = window.innerHeight * 0.34;
      let current = 'home';
      for (const l of LINKS.slice(1)) {
        const el = document.getElementById(l.id);
        if (el && el.getBoundingClientRect().top <= line) current = l.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className="lp">
      <header className={`lp-nav${scrolled ? ' lp-nav-scrolled' : ''}`}>
        <div className="lp-nav-inner">
          <Brand />
          <nav className="lp-links" aria-label="Sections">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={active === l.id ? 'active' : undefined}
                aria-current={active === l.id ? 'true' : undefined}
                onClick={(e) => {
                  if (l.id === 'home' && window.location.pathname === '/') {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
              >
                {l.label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="lp-burger"
            aria-label={menu ? 'Close menu' : 'Open menu'}
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <Icon name={menu ? 'x' : 'menu'} size={22} />
          </button>
          <div className="public-actions">
            <a href={appUrl('/join/')} className="btn btn-ghost btn-small btn-link">
              Join Exam
            </a>
            <a href={appUrl('/login/')} className="btn btn-primary btn-small btn-link">
              Conduct Exam
            </a>
          </div>
        </div>
        {menu && (
          <nav className="lp-mobile" aria-label="Menu">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={active === l.id ? 'active' : undefined}
                onClick={(e) => {
                  setMenu(false);
                  if (l.id === 'home' && window.location.pathname === '/') {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
              >
                {l.label}
              </a>
            ))}
            <div className="lp-mobile-cta">
              <a href={appUrl('/join/')} className="btn btn-secondary btn-link">
                Join Exam
              </a>
              <a href={appUrl('/login/')} className="btn btn-primary btn-link">
                Conduct Exam
              </a>
            </div>
          </nav>
        )}
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <a href={appUrl('/terms/')}>Terms of use</a>
        <a href={appUrl('/privacy/')}>Privacy policy</a>
        <a href={appUrl('/refund-policy/')}>Refund policy</a>
        <a href={appUrl('/contact/')}>Contact</a>
        <span>&copy; NandiVex Technologies</span>
      </footer>
    </div>
  );
}
