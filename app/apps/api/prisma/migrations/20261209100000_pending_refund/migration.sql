-- A refund is first claimed as PENDING_REFUND; it becomes REFUNDED only after the gateway and the ledger both finished.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING_REFUND' BEFORE 'REFUNDED';
