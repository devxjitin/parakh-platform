import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

import { LedgerModule } from '../ledger/ledger.module';
import { AccountService } from './account.service';

@Module({
  imports: [LedgerModule],
  controllers: [UsersController],
  providers: [UsersService, AccountService],
  exports: [UsersService],
})
export class UsersModule {}
