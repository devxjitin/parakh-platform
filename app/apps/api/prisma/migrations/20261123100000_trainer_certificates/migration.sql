-- Trainer certificates (Certificate of Appreciation for conducting an exam)
ALTER TYPE "CertificateKind" ADD VALUE 'TRAINER';

ALTER TABLE "Certificate" ALTER COLUMN "attemptId" DROP NOT NULL;
ALTER TABLE "Certificate" ADD COLUMN "participants" INTEGER;
