-- AlterTable: make tenantId nullable (expenses have no tenant)
ALTER TABLE "Payment" ALTER COLUMN "tenantId" DROP NOT NULL;

-- AlterTable: add propertyId for direct property link on expenses
ALTER TABLE "Payment" ADD COLUMN "propertyId" TEXT;

-- AddForeignKey: propertyId
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: propertyId
CREATE INDEX "Payment_propertyId_idx" ON "Payment"("propertyId");

-- CreateIndex: tenantId (declared in schema but missing from initial migration)
CREATE INDEX IF NOT EXISTS "Payment_tenantId_idx" ON "Payment"("tenantId");

-- AlterForeignKey: tenantId ON DELETE SET NULL (default Restrict prevents deleting tenants with payments)
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_tenantId_fkey";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
