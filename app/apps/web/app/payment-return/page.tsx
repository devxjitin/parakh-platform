'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublishResultDto } from '@parakh/shared';
import { Alert, Button, Card, Shell, describeError } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/**
 * Razorpay sends the payer here after a Payment Link, with the payment details and a signature in
 * the query string. The server checks the signature, confirms the payment, and says where to go.
 */
export default function PaymentReturnPage() {
  const auth = useAuth();
  const [error, setError] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (auth.loading || started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const linkId = q.get('razorpay_payment_link_id');
    const paymentId = q.get('razorpay_payment_id');
    const status = q.get('razorpay_payment_link_status');
    if (!linkId || !paymentId || status !== 'paid') {
      setCancelled(true);
      return;
    }
    if (!auth.user) {
      setError('Sign in again to finish. Your payment is safe and will be confirmed.');
      return;
    }
    api<PublishResultDto>('/payments/verify-link', {
      method: 'POST',
      body: {
        linkId,
        paymentId,
        status,
        referenceId: q.get('razorpay_payment_link_reference_id') ?? '',
        signature: q.get('razorpay_signature') ?? '',
      },
    })
      .then((r) => {
        window.location.replace(r.next ?? '/dashboard/');
      })
      .catch((err) => setError(describeError(err).message));
  }, [auth.loading, auth.user]);

  const home = auth.user?.role === 'STUDENT' ? '/join/' : '/dashboard/';

  return (
    <Shell>
      <Card
        title={
          cancelled ? 'Payment not completed' : error ? 'Almost there' : 'Confirming your payment'
        }
        subtitle={
          cancelled
            ? 'No money was taken. You can go back and try again.'
            : error
              ? undefined
              : 'Please wait a moment and do not close this page.'
        }
      >
        {error && <Alert>{error}</Alert>}
        {(cancelled || error) && (
          <Button onClick={() => window.location.replace(home)}>Go back</Button>
        )}
      </Card>
    </Shell>
  );
}
