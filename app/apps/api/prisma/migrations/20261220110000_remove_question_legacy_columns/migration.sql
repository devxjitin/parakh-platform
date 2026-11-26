-- Dropped questions, negative marking and coding questions were removed from the product.
-- Production had no questions using them when this was written (checked read-only).
ALTER TABLE "Question" DROP COLUMN "negativeMarks",
  DROP COLUMN "coding",
  DROP COLUMN "revision",
  DROP COLUMN "droppedAt";
ALTER TABLE "Answer" DROP COLUMN "language",
  DROP COLUMN "runs",
  DROP COLUMN "lastRunAt";
