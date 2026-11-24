import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { AccommodationsController } from './accommodations.controller';
import { AccommodationsService } from './accommodations.service';
import { AttemptSweeperService } from './attempt-sweeper.service';
import { CorrectionsController } from './corrections.controller';
import { CorrectionsService } from './corrections.service';
import { GradingService } from './grading.service';
import { ResultsDeliveryService } from './results-delivery.service';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

@Module({
  imports: [CertificatesModule],
  controllers: [ResultsController, CorrectionsController, AccommodationsController],
  providers: [
    GradingService,
    ResultsService,
    CorrectionsService,
    AccommodationsService,
    AttemptSweeperService,
    ResultsDeliveryService,
  ],
  exports: [GradingService, ResultsService, ResultsDeliveryService],
})
export class ResultsModule {}
