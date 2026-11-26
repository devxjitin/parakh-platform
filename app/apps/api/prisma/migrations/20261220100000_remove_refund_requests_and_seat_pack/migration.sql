-- Students can no longer ask for a refund, and seat packs are no longer sold. Production had no
-- RefundRequest rows and no SEAT_PACK payments when this was written (checked read-only).
DROP TABLE "RefundRequest";
DROP TYPE "RefundRequestStatus";

-- Drop the unused SEAT_PACK value from the payment purpose type.
ALTER TYPE "PaymentPurpose" RENAME TO "PaymentPurpose_old";
CREATE TYPE "PaymentPurpose" AS ENUM ('EXAM_CREATION', 'EXAM_JOIN');
ALTER TABLE "Payment" ALTER COLUMN "purpose" TYPE "PaymentPurpose" USING ("purpose"::text::"PaymentPurpose");
DROP TYPE "PaymentPurpose_old";
