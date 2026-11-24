import { LegalPage } from '../../components/legal';

export const metadata = { title: 'Terms of use | Parakh' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <h2>1. Who we are</h2>
      <p>
        Parakh is an online assessment and certificate service run by NandiVex Technologies
        [registered address and entity type to be confirmed] (&quot;we&quot;, &quot;us&quot;).
      </p>

      <h2>2. Accounts</h2>
      <p>
        You must give a real name and an email address you own. You are responsible for what happens
        under your account and for keeping your password private. Trainers and students have
        different accounts; one person who needs both uses two email addresses.
      </p>

      <h2>3. Trainers</h2>
      <p>
        A trainer creates exams, pays the publishing fee shown at checkout, and is responsible for
        the questions, the fairness of the marking and what they promise their students. A trainer
        may only upload content they have the right to use. We may suspend an exam or account that
        breaks these terms or the law.
      </p>

      <h2>4. Students and exam conduct</h2>
      <p>
        You must take the exam yourself and not share questions or answers. During an exam the
        platform records when you leave the exam screen, your IP address and a device identifier,
        and may submit your exam automatically if the trainer has chosen that setting. Your trainer
        can see this record. Copying, pasting and similar actions may be blocked.
      </p>

      <h2>5. Payments</h2>
      <p>
        Prices are shown in Indian rupees before you pay. Payments are processed by our payment
        partner; we never see your card or UPI details. [Tax treatment and GST invoice details to be
        confirmed with an accountant.] Refunds are described in the{' '}
        <a href="/refund-policy/">refund policy</a>.
      </p>

      <h2>6. Certificates</h2>
      <p>
        A certificate shows the name on the account, the exam and the result. It carries a serial
        number and a signature so anyone can check it at the verification page. We may revoke a
        certificate that was issued by mistake or obtained by cheating.
      </p>

      <h2>7. Acceptable use</h2>
      <p>
        Do not try to break, overload or reverse-engineer the service, access another person&apos;s
        data, or use it for anything unlawful.
      </p>

      <h2>8. Availability and liability</h2>
      <p>
        We work to keep the service running but cannot promise it will never be interrupted. If an
        interruption affects an exam, the trainer can extend or reopen it. [Limit of liability and
        governing law / court jurisdiction to be set by a lawyer.]
      </p>

      <h2>9. Changes</h2>
      <p>
        If we change these terms in a way that matters, we will update the version number above and
        ask you to accept the new version. [Notice period to be confirmed.]
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these terms: see the <a href="/contact/">contact page</a>.
      </p>
    </LegalPage>
  );
}
