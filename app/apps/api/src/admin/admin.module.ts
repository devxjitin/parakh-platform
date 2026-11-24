import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { AdminController } from './admin.controller';
import { AdminReportsService } from './admin-reports.service';

@Module({
  imports: [LedgerModule],
  controllers: [AdminController],
  providers: [AdminReportsService],
})
export class AdminModule {}
