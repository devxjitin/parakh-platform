import { LegalPage } from '../../components/legal';

export const metadata = { title: 'Terms of use' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="last updated 24 November 2026" draft={false}>
      <p>
        Welcome to NandiRank. By accessing or using our platform at app.nandirank.nandivex.com, you
        agree to comply with and be bound by these Terms of Use.
      </p>

      <h2>1. Who we are</h2>
      <p>
        NandiRank (&quot;Service&quot;, &quot;Platform&quot;) is an online examination, assessment
        and digital certificate verification service operated by NandiVex Technologies
        (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
      </p>

      <h2>2. User accounts</h2>
      <ul>
        <li>You must give a valid email address and your real name.</li>
        <li>
          You are responsible for keeping your password private and for everything done under your
          account.
        </li>
        <li>
          Trainers and students have different accounts. A person who needs both roles must use two
          separate email addresses.
        </li>
      </ul>

      <h2>3. Trainers and exam management</h2>
      <ul>
        <li>
          Trainers create and publish exams, pay the publishing fee, and are solely responsible for
          the accuracy of questions, answer keys, fair marking and what they promise their students.
        </li>
        <li>Trainers may only upload content they have the legal right or licence to use.</li>
        <li>
          We may suspend or end any exam or account that breaks these terms or any applicable law.
        </li>
      </ul>

      <h2>4. Students and exam conduct</h2>
      <ul>
        <li>
          Students must take exams on their own and must not share questions, answers or study
          material during an active session.
        </li>
        <li>
          <b>Proctoring records:</b> during an exam the platform records events such as leaving or
          switching the exam screen (tab switch), how long the session is active, your IP address
          and device identifiers.
        </li>
        <li>
          If the trainer has turned it on, going over the tab-switching limit may submit the exam
          automatically.
        </li>
        <li>Copying, pasting and right-click actions are blocked during an active test.</li>
      </ul>

      <h2>5. Payments and invoices</h2>
      <ul>
        <li>Prices are shown in Indian rupees (INR) before you pay.</li>
        <li>
          Payments are processed by secure, RBI-compliant payment partners. We do not store your
          debit or credit card numbers or UPI PIN.
        </li>
        <li>
          Refunds are governed by our <a href="/refund-policy/">refund policy</a>.
        </li>
      </ul>

      <h2>6. Digital certificates</h2>
      <ul>
        <li>
          A certificate shows the candidate&apos;s account name, the exam title, the date and the
          score or result.
        </li>
        <li>
          Each certificate has a unique serial number and a digital signature that anyone can check
          on our public verification page.
        </li>
        <li>
          We may revoke a certificate that was issued because of a technical fault or obtained by
          dishonest means.
        </li>
      </ul>

      <h2>7. Acceptable use</h2>
      <p>
        You agree not to disrupt, overload, reverse-engineer, exploit or tamper with the platform,
        try to reach another user&apos;s data without permission, or use the service for anything
        unlawful.
      </p>

      <h2>8. Availability and limitation of liability</h2>
      <ul>
        <li>
          We work to keep the service available but cannot promise it will never be interrupted. If
          an unplanned outage on our side affects an active exam, we will offer a free re-test or a
          refund as described in the <a href="/refund-policy/">refund policy</a>.
        </li>
        <li>
          To the fullest extent the law allows, NandiVex Technologies is not liable for any
          indirect, special or consequential damage that results from using the platform.
        </li>
      </ul>

      <h2>9. Governing law and jurisdiction</h2>
      <p>
        These terms are governed by the laws of India. Any legal dispute or claim arising out of or
        related to these terms is subject to the exclusive jurisdiction of the competent courts in
        India.
      </p>

      <h2>10. Changes and contact</h2>
      <p>
        We may update these terms as our services change. For questions or notices, visit our{' '}
        <a href="/contact/">contact page</a> or email{' '}
        <a href="mailto:support@nandivex.com">support@nandivex.com</a>.
      </p>
    </LegalPage>
  );
}
