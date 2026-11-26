'use client';

import { CertificateCheck as Check } from '@parakh/ui/certificate-check';
import { API_URL } from '../lib/api';
import { Req } from './ui';

export function CertificateCheck({ initialSerial = '' }: { initialSerial?: string }) {
  return <Check initialSerial={initialSerial} apiUrl={API_URL} requiredMark={<Req />} />;
}
