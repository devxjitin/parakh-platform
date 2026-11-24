import { LegalPage } from '../../components/legal';

export const metadata = { title: 'Refund policy | Parakh' };

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Refund policy">
      <h2>Students</h2>
      <ul>
        <li>
          <b>The trainer cancels the exam:</b> the fee is not refunded. A cancelled exam cannot be
          joined or started any more.
        </li>
        <li>
          <b>You paid but the exam could not be joined</b> (for example the exam closed while you
          were paying, or you paid twice): the extra or unusable payment is refunded in full.
        </li>
        <li>
          <b>You change your mind:</b> once you have paid, your seat is yours and the fee is not
          refunded. Please make sure you can take the exam before you pay.
        </li>
        <li>
          <b>You started the exam:</b> the fee is not refunded, except where the exam could not be
          completed because of a fault on our side.
        </li>
      </ul>

      <h2>Trainers</h2>
      <ul>
        <li>
          <b>Publishing fee:</b> [owner to decide: refundable until the first student joins, or not
          refundable].
        </li>
        <li>
          <b>Sponsored seats you bought for students:</b> a seat is used when a student redeems it.
          Seats that are still unused after the exam closes are not refunded.
        </li>
        <li>
          <b>If you cancel an exam</b> that students have paid for, their fees are not refunded.
        </li>
      </ul>

      <h2>How and when</h2>
      <p>
        Refunds go back to the original payment method. Your bank or UPI app usually shows them
        within [5 to 7] working days. You get an email when a refund is issued. If you have not
        received one, write to us from the <a href="/contact/">contact page</a>.
      </p>
    </LegalPage>
  );
}
