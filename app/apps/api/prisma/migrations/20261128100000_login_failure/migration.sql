CREATE TABLE "LoginFailure" (
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoginFailure_pkey" PRIMARY KEY ("email","ip")
);

CREATE INDEX "LoginFailure_updatedAt_idx" ON "LoginFailure"("updatedAt");
