import { Module } from '@nestjs/common';
import { ResultsModule } from '../results/results.module';
import { PracticeController } from './practice.controller';
import { PracticeService } from './practice.service';

@Module({
  imports: [ResultsModule],
  controllers: [PracticeController],
  providers: [PracticeService],
})
export class PracticeModule {}
