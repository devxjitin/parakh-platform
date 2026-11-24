-- Editable platform settings and the one-time exam reminder marker.
ALTER TABLE "Enrollment" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);
