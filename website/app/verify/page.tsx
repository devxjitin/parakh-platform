'use client';

import { useEffect, useState } from 'react';
import { CertificateCheck } from '../../components/certificate-check';
import { LandingFrame } from '../../components/landing-frame';

/** Public: anyone (an employer, a college) can check a certificate. No sign-in. */
export default function VerifyPage() {
  const [serial, setSerial] = useState('');
  useEffect(() => {
    setSerial(new URLSearchParams(window.location.search).get('serial') ?? '');
  }, []);
  return (
    <LandingFrame>
      <section className="lp-section">
        <div className="lp-container" style={{ maxWidth: 720 }}>
          <h1>Check a certificate</h1>
          <p className="muted">
            Enter the serial number printed on the certificate, or scan its QR code.
          </p>
          <CertificateCheck initialSerial={serial} />
        </div>
      </section>
    </LandingFrame>
  );
}
