-- Freeze the trainer share percent on a join payment when the order is made.
ALTER TABLE "Payment" ADD COLUMN "examinerSharePercent" INTEGER;
