import { LegalPage } from '../../components/legal';

export const metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <LegalPage title="Contact us" updated="last updated 24 November 2026" draft={false}>
      <p>
        We are here to help. If you have questions about our platform, examinations, payments, or
        data privacy, please reach out to us.
      </p>

      <h2>Operating entity</h2>
      <p>
        Parakh is an online platform operated by NandiVex Technologies. Location: operating online
        across India.
      </p>

      <h2>Support and inquiries</h2>
      <ul>
        <li>
          <b>Support email:</b> <a href="mailto:support@nandivex.com">support@nandivex.com</a>
        </li>
        <li>
          <b>Operating hours:</b> Monday to Saturday, 10:00 AM to 6:00 PM IST
        </li>
        <li>
          <b>Response time:</b> we aim to reply to all queries within 24 to 48 business hours.
        </li>
      </ul>

      <h2>Payments and refunds</h2>
      <p>
        For any payment failure, duplicate transaction, or refund status inquiry, please write to{' '}
        <a href="mailto:support@nandivex.com">support@nandivex.com</a> with:
      </p>
      <ol>
        <li>Your registered email ID</li>
        <li>Exam name and date</li>
        <li>Payment reference or transaction ID</li>
      </ol>

      <h2>Grievance and compliance officer</h2>
      <p>
        In accordance with the Information Technology Act, 2000 and the Digital Personal Data
        Protection Act:
      </p>
      <ul>
        <li>
          <b>Grievance officer:</b> Jitin Kumar Sengar
        </li>
        <li>
          <b>Email:</b> <a href="mailto:support@nandivex.com">support@nandivex.com</a>
        </li>
        <li>
          <b>Resolution timeline:</b> grievances are acknowledged within 24 hours and addressed
          within 15 working days.
        </li>
      </ul>
    </LegalPage>
  );
}
