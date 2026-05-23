-- AlterTable: add notification contact fields to Owner (nullable)
ALTER TABLE "Owner" ADD COLUMN "notificationPhone" TEXT;
ALTER TABLE "Owner" ADD COLUMN "notificationEmail" TEXT;
