-- AlterTable
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "needsPackaging" BOOLEAN NOT NULL DEFAULT false;
