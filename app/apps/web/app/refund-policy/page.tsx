import { LegalPage } from '../../components/legal';

export const metadata = { title: 'Refund policy' };

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund policy" updated="last updated 24 November 2026" draft={false}>
      <p>
        This policy sets out the terms for cancellations and refunds for services bought on Parakh
        (app.parakh.nandivex.com), operated by NandiVex Technologies.
      </p>

      <h2>1. For students</h2>
      <ul>
        <li>
          <b>Duplicate charges and technical errors:</b> if you are charged twice for the same exam
          because of a technical error, or money is deducted but you cannot enter the exam because
          of a verified platform error, the amount is refunded in full.
        </li>
        <li>
          <b>Platform-wide outage:</b> if an exam cannot be completed because of a verified outage
          on the Parakh servers, we will give you a free re-test or a full refund, at our
          discretion.
        </li>
        <li>
          <b>The trainer cancels the exam:</b> the fee is not refunded. A cancelled exam cannot be
          joined or started any more.
        </li>
        <li>
          <b>Withdrawal or change of mind:</b> once you have paid for an exam seat, the fee is not
          refunded. Please make sure your schedule and internet connection are ready before you pay.
        </li>
      </ul>

      <h2>2. For trainers</h2>
      <ul>
        <li>
          <b>Publishing fee:</b> the fee is not refunded once an exam has been published and can be
          joined on the platform.
        </li>
        <li>
          <b>Prepaid student seats:</b> a sponsored seat is used when the student joins. Seats that
          are still unused after the exam closes are not refunded.
        </li>
        <li>
          <b>If you cancel an exam</b> that students have paid for, their fees are not refunded.
        </li>
      </ul>

      <h2>3. How refunds are processed</h2>
      <ul>
        <li>
          <b>Mode:</b> refunds go back to the original payment source: the same bank account, card
          or UPI ID used at checkout.
        </li>
        <li>
          <b>Timeline:</b> approved refunds are started right away and usually show in your bank or
          UPI app within 5 to 7 working days, depending on your bank. You get an email when a refund
          is issued.
        </li>
        <li>
          <b>Help:</b> for refund help, write to{' '}
          <a href="mailto:support@nandivex.com">support@nandivex.com</a> with your registered email
          ID and payment reference, or use the <a href="/contact/">contact page</a>.
        </li>
      </ul>
    </LegalPage>
  );
}
