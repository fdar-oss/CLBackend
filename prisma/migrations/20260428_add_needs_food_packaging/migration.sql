-- AlterTable
ALTER TABLE "pos_orders" ADD COLUMN IF NOT EXISTS "needsFoodPackaging" BOOLEAN NOT NULL DEFAULT false;
