import { Module } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { CertificatesModule } from '../certificates/certificates.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ExamLifecycleController } from './exam-lifecycle.controller';
import { ExamLifecycleService } from './exam-lifecycle.service';
import { AdminRefundRequestsController, MyPaymentsController } from './my-payments.controller';
import { MyPaymentsService } from './my-payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { RefundSweeperService } from './refund-sweeper.service';
import { PAYMENT_PROVIDER, createPaymentProvider } from './provider';

@Module({
  imports: [LedgerModule, CertificatesModule],
  controllers: [
    PaymentsController,
    ExamLifecycleController,
    MyPaymentsController,
    AdminRefundRequestsController,
    ReconciliationController,
  ],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) => createPaymentProvider(env),
    },
    PaymentsService,
    ExamLifecycleService,
    MyPaymentsService,
    RefundSweeperService,
    ReconciliationService,
  ],
})
export class PaymentsModule {}
