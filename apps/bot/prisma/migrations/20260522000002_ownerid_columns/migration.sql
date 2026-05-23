-- Migration M2: add ownerId to 11 tables + index on Property.ownerId
-- Requires at least 1 Owner in the database.

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Owner") = 0 THEN
    RAISE EXCEPTION 'Migration M2 requires at least 1 Owner in the database.';
  END IF;
END $$;

-- Property: index only (ownerId already exists)
CREATE INDEX "Property_ownerId_idx" ON "Property"("ownerId");

-- Tenant
ALTER TABLE "Tenant" ADD COLUMN "ownerId" TEXT;
UPDATE "Tenant" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "Tenant" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Tenant_ownerId_idx" ON "Tenant"("ownerId");

-- Lead
ALTER TABLE "Lead" ADD COLUMN "ownerId" TEXT;
UPDATE "Lead" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "Lead" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");

-- Payment
ALTER TABLE "Payment" ADD COLUMN "ownerId" TEXT;
UPDATE "Payment" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "Payment" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Payment_ownerId_idx" ON "Payment"("ownerId");

-- Contract
ALTER TABLE "Contract" ADD COLUMN "ownerId" TEXT;
UPDATE "Contract" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "Contract" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Contract_ownerId_idx" ON "Contract"("ownerId");

-- RuleSet
ALTER TABLE "RuleSet" ADD COLUMN "ownerId" TEXT;
UPDATE "RuleSet" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "RuleSet" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "RuleSet" ADD CONSTRAINT "RuleSet_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RuleSet_ownerId_idx" ON "RuleSet"("ownerId");

-- ContractTemplate
ALTER TABLE "ContractTemplate" ADD COLUMN "ownerId" TEXT;
UPDATE "ContractTemplate" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "ContractTemplate" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ContractTemplate_ownerId_idx" ON "ContractTemplate"("ownerId");

-- PropertyMedia
ALTER TABLE "PropertyMedia" ADD COLUMN "ownerId" TEXT;
UPDATE "PropertyMedia" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "PropertyMedia" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "PropertyMedia" ADD CONSTRAINT "PropertyMedia_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PropertyMedia_ownerId_idx" ON "PropertyMedia"("ownerId");

-- LeadDocument
ALTER TABLE "LeadDocument" ADD COLUMN "ownerId" TEXT;
UPDATE "LeadDocument" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "LeadDocument" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LeadDocument_ownerId_idx" ON "LeadDocument"("ownerId");

-- ActivityLog (Cascade: deleting owner removes its logs)
ALTER TABLE "ActivityLog" ADD COLUMN "ownerId" TEXT;
UPDATE "ActivityLog" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "ActivityLog" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ActivityLog_ownerId_idx" ON "ActivityLog"("ownerId");

-- Conversation
ALTER TABLE "Conversation" ADD COLUMN "ownerId" TEXT;
UPDATE "Conversation" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "Conversation" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Conversation_ownerId_idx" ON "Conversation"("ownerId");

-- Event
ALTER TABLE "Event" ADD COLUMN "ownerId" TEXT;
UPDATE "Event" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "Event" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Event" ADD CONSTRAINT "Event_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");
