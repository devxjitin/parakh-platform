import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import {
  AdminFinanceController,
  EarningsController,
  PayoutsController,
} from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [LedgerModule],
  controllers: [PayoutsController, EarningsController, AdminFinanceController],
  providers: [PayoutsService],
})
export class PayoutsModule {}
