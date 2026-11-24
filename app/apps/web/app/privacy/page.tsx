import { LegalPage } from '../../components/legal';

export const metadata = { title: 'Privacy policy | Parakh' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <h2>1. What we collect</h2>
      <ul>
        <li>
          <b>Account:</b> your name, email address, password (stored only as a one-way hash), role
          and, if you give it, your phone number and organisation.
        </li>
        <li>
          <b>Exams:</b> your answers, scores, results and certificates.
        </li>
        <li>
          <b>Proctoring record:</b> events such as leaving the exam screen, with time, IP address
          and a device identifier, so your trainer can review fairness.
        </li>
        <li>
          <b>Payments:</b> order and payment references, amount and status. Card and UPI details go
          to our payment partner and are not stored by us.
        </li>
        <li>
          <b>Trainer payouts:</b> payout details (UPI or bank), stored encrypted.
        </li>
        <li>
          <b>Technical:</b> sign-in sessions and security logs (for example failed sign-ins).
        </li>
      </ul>

      <h2>2. Why we use it</h2>
      <p>
        To run exams, mark them, issue and verify certificates, take and refund payments, pay
        trainers, keep the service secure, and send the emails you need (verification codes,
        receipts, results). We do not sell your data and we do not send marketing email unless you
        ask for it.
      </p>

      <h2>3. Who sees it</h2>
      <ul>
        <li>
          <b>Your trainer</b> sees your name, email, answers, result and proctoring record for exams
          you join.
        </li>
        <li>
          <b>Anyone with a certificate link</b> can see the name, exam and result on that
          certificate.
        </li>
        <li>
          <b>Service providers</b> that run the platform for us: hosting and storage, email
          delivery, payments. [List providers and where data is stored to be confirmed.]
        </li>
        <li>We disclose data when the law requires it.</li>
      </ul>

      <h2>4. How long we keep it</h2>
      <p>
        [Retention periods to be confirmed: account data, exam answers, proctoring records, payment
        and tax records.] Payment, ledger and certificate records are kept even after an account is
        closed, because we are required to keep financial records and certificates must stay
        verifiable.
      </p>

      <h2>5. Your rights</h2>
      <p>
        You can ask to see, correct or delete your personal data, and to withdraw consent. On a
        deletion request your name, email and phone are anonymised and your sign-in is removed;
        payment, ledger and certificate records are kept as described above. Sign in and open{' '}
        <b>Profile &gt; Your data</b> to download everything we hold about you as a file, or to
        close your account. Trainers must first close or cancel open exams and be paid out.
        [Grievance officer name and contact, as required under Indian law, to be added.] For
        anything else, contact us through the <a href="/contact/">contact page</a>.
      </p>

      <h2>6. Security</h2>
      <p>
        Data is sent over HTTPS, passwords are hashed, payout details are encrypted, and access is
        limited by role. No system is perfectly secure; tell us at once if you think your account
        was accessed by someone else.
      </p>

      <h2>7. Children</h2>
      <p>
        [Minimum age and guardian consent wording to be confirmed, as students may be under 18.]
      </p>
    </LegalPage>
  );
}
