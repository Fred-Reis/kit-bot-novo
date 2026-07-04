-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "declaredIncome" DECIMAL(65,30),
ADD COLUMN     "expectedResidents" INTEGER;

-- CreateTable
CREATE TABLE "LeadResident" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sex" TEXT,
    "age" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadResident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadResident_ownerId_idx" ON "LeadResident"("ownerId");

-- CreateIndex
CREATE INDEX "LeadResident_leadId_idx" ON "LeadResident"("leadId");

-- AddForeignKey
ALTER TABLE "LeadResident" ADD CONSTRAINT "LeadResident_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadResident" ADD CONSTRAINT "LeadResident_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
