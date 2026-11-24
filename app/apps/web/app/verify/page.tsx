'use client';

import { CertificateCheck } from '../../components/certificate-check';
import { Shell, useQueryParam } from '../../components/ui';

/** Public: anyone (an employer, a college) can check a certificate. No sign-in. */
export default function VerifyPage() {
  const fromLink = useQueryParam('serial');
  return (
    <Shell>
      <section className="card">
        <h1>Check a certificate</h1>
        <p className="muted">
          Enter the serial number printed on the certificate, or scan its QR code.
        </p>
        <CertificateCheck initialSerial={fromLink ?? ''} />
      </section>
    </Shell>
  );
}
