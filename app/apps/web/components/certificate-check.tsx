'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CERT_KIND_TITLE, type VerifyCertificateDto } from '@parakh/shared';
import { API_URL } from '../lib/api';
import { Icon } from './icons';
import { Req } from './ui';

const day = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';

/**
 * Turns whatever was typed into the serial format: capitals, dashes in the right places, and the
 * PRK prefix added when it was left out. "prk877t3ltc" becomes "PRK-877T-3LTC".
 */
export function formatSerial(input: string): string {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return '';
  if ('PRK'.startsWith(clean)) return clean; // still typing the prefix
  const body = (clean.startsWith('PRK') ? clean.slice(3) : clean).slice(0, 12);
  const blocks = body.match(/.{1,4}/g) ?? [];
  return ['PRK', ...blocks].join('-');
}

/**
 * Public certificate check: enter the serial number (or arrive from a QR code link) and see
 * whether it is genuine. No sign-in. Used on the landing page and on /verify.
 */
export function CertificateCheck({ initialSerial = '' }: { initialSerial?: string }) {
  const [serial, setSerial] = useState('');
  const [result, setResult] = useState<VerifyCertificateDto | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function check(value: string) {
    const s = value.trim();
    if (!s) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/verify/${encodeURIComponent(s)}`);
      if (!res.ok) throw new Error('failed');
      setResult((await res.json()) as VerifyCertificateDto);
    } catch {
      setError('Could not check right now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const dismiss = () => {
    setResult(null);
    setError('');
  };
  useEffect(() => {
    if (!result && !error) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, error]);

  useEffect(() => {
    if (initialSerial) {
      setSerial(formatSerial(initialSerial));
      void check(formatSerial(initialSerial));
    }
  }, [initialSerial]);

  return (
    <div className="cert-check">
      <form
        className="cert-check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void check(serial);
        }}
      >
        <div className="cc-field">
          <label htmlFor="cc-serial">
            Serial number
            <Req />
          </label>
          <div className="cc-box">
            <span className="cc-ico" aria-hidden="true">
              <Icon name="qr" size={18} />
            </span>
            <input
              id="cc-serial"
              value={serial}
              onChange={(e) => setSerial(formatSerial(e.target.value))}
              placeholder="PRK-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <button
              type="submit"
              className="btn btn-primary cc-go"
              disabled={busy || !serial.trim()}
              aria-busy={busy || undefined}
            >
              {busy ? 'Checking...' : 'Check'}
            </button>
          </div>
        </div>
      </form>

      {(error || result) &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="cc-modal" onClick={dismiss}>
            <div
              className="cc-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Certificate check result"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="cc-close"
                onClick={dismiss}
                aria-label="Close"
                autoFocus
              >
                <Icon name="x" size={18} />
              </button>
              {error && (
                <div className="cc-result bad" role="alert">
                  <span className="cc-result-ico" aria-hidden="true">
                    <Icon name="alert" size={22} />
                  </span>
                  <div>
                    <h4>Could not check right now</h4>
                    <p>Please try again in a moment.</p>
                  </div>
                </div>
              )}

              {result?.state === 'VALID' && (
                <div className="cc-result ok" role="status">
                  <div className="cc-result-head">
                    <span className="cc-result-ico" aria-hidden="true">
                      <Icon name="check" size={22} />
                    </span>
                    <div>
                      <h4>This certificate is genuine</h4>
                      <p>It was issued through Parakh and is still valid.</p>
                    </div>
                  </div>
                  <div className="cc-holder">
                    <span className="cc-holder-label">Awarded to</span>
                    <b>{result.holderName}</b>
                    <span className="cc-kind">
                      {result.kind ? CERT_KIND_TITLE[result.kind] : ''}
                    </span>
                  </div>
                  <dl className="cc-facts">
                    <div>
                      <dt>Exam</dt>
                      <dd>{result.examTitle}</dd>
                    </div>
                    {result.organisation && (
                      <div>
                        <dt>Conducted by</dt>
                        <dd>{result.organisation}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Issued on</dt>
                      <dd>{day(result.issuedOn)}</dd>
                    </div>
                    <div>
                      <dt>Serial number</dt>
                      <dd className="cc-serial">{result.serialNo}</dd>
                    </div>
                  </dl>
                </div>
              )}
              {result?.state === 'REVOKED' && (
                <div className="cc-result bad" role="alert">
                  <span className="cc-result-ico" aria-hidden="true">
                    <Icon name="alert" size={22} />
                  </span>
                  <div>
                    <h4>This certificate was withdrawn</h4>
                    <p>It is no longer valid. Contact the issuer if you have questions.</p>
                  </div>
                </div>
              )}
              {result?.state === 'NOT_FOUND' && (
                <div className="cc-result bad" role="alert">
                  <span className="cc-result-ico" aria-hidden="true">
                    <Icon name="x" size={22} />
                  </span>
                  <div>
                    <h4>No certificate found with this serial number</h4>
                    <p>
                      Check the number and try again. If it is correct, the certificate is not
                      genuine.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
