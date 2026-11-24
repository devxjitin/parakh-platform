-- Sprint 8: ledger, payouts, refunds, sponsored seats
-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('UPI', 'BANK');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'PAID', 'REJECTED');

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'SEAT_PACK';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "seatId" UUID;

-- AlterTable
ALTER TABLE "ExaminerProfile" ADD COLUMN     "bankAccountLast4" TEXT,
ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNoEnc" TEXT,
ADD COLUMN     "ifsc" TEXT,
ADD COLUMN     "payoutDetailsUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "payoutDetailsVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "payoutMethod" "PayoutMethod",
ADD COLUMN     "upiId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "txnId" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "paymentId" UUID,
    "payoutId" UUID,
    "examId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "examinerId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" "PayoutMethod",
    "destination" TEXT,
    "utr" TEXT,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidById" UUID,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatPack" (
    "id" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "sponsorId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT,
    "redeemedById" UUID,
    "redeemedAt" TIMESTAMP(3),
    "enrollmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerEntry_account_createdAt_idx" ON "LedgerEntry"("account", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_txnId_idx" ON "LedgerEntry"("txnId");

-- CreateIndex
CREATE INDEX "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");

-- CreateIndex
CREATE INDEX "LedgerEntry_examId_idx" ON "LedgerEntry"("examId");

-- CreateIndex
CREATE INDEX "Payout_examinerId_requestedAt_idx" ON "Payout"("examinerId", "requestedAt");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SeatPack_paymentId_key" ON "SeatPack"("paymentId");

-- CreateIndex
CREATE INDEX "SeatPack_examId_idx" ON "SeatPack"("examId");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_token_key" ON "Seat"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Seat_enrollmentId_key" ON "Seat"("enrollmentId");

-- CreateIndex
CREATE INDEX "Seat_packId_idx" ON "Seat"("packId");

-- CreateIndex
CREATE INDEX "Seat_email_idx" ON "Seat"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_seatId_key" ON "Enrollment"("seatId");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_examinerId_fkey" FOREIGN KEY ("examinerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatPack" ADD CONSTRAINT "SeatPack_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatPack" ADD CONSTRAINT "SeatPack_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatPack" ADD CONSTRAINT "SeatPack_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_packId_fkey" FOREIGN KEY ("packId") REFERENCES "SeatPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

