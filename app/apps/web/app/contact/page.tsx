import { LegalPage } from '../../components/legal';

export const metadata = { title: 'Contact | Parakh' };

export default function ContactPage() {
  return (
    <LegalPage title="Contact us">
      <p>Parakh is run by NandiVex Technologies [registered address to be confirmed].</p>
      <ul>
        <li>
          <b>Support email:</b> [support email address to be confirmed]
        </li>
        <li>
          <b>Phone:</b> [optional: support phone number and hours]
        </li>
        <li>
          <b>Payments and refunds:</b> write to the support address with your receipt number.
        </li>
        <li>
          <b>Privacy requests and complaints:</b> [grievance officer name and email to be added]
        </li>
      </ul>
      <p>We aim to reply within [2] working days.</p>
    </LegalPage>
  );
}
