ALTER TABLE "Contract"
  ALTER COLUMN "tenantId" DROP NOT NULL,
  ALTER COLUMN "startDate" DROP NOT NULL,
  ADD COLUMN "leadId" TEXT,
  ADD CONSTRAINT "Contract_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Contract_leadId_idx" ON "Contract"("leadId");
