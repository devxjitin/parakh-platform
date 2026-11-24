import { Module } from '@nestjs/common';
import { CertificatesController, MailEventsController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  controllers: [CertificatesController, MailEventsController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
