-- CreateTable
CREATE TABLE "Coordinator" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coordinator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyCoordinator" (
    "propertyId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "responsibilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "PropertyCoordinator_pkey" PRIMARY KEY ("propertyId","coordinatorId")
);

-- CreateIndex
CREATE INDEX "Coordinator_ownerId_idx" ON "Coordinator"("ownerId");

-- AddForeignKey
ALTER TABLE "Coordinator" ADD CONSTRAINT "Coordinator_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCoordinator" ADD CONSTRAINT "PropertyCoordinator_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCoordinator" ADD CONSTRAINT "PropertyCoordinator_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "Coordinator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RowLevelSecurity (created but not enabled globally — see PR #29 / docs/adrs/001-rls-strategy.md)
ALTER TABLE "Coordinator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Coordinator" FORCE ROW LEVEL SECURITY;
CREATE POLICY "select_own_rows" ON "Coordinator"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

ALTER TABLE "PropertyCoordinator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PropertyCoordinator" FORCE ROW LEVEL SECURITY;
CREATE POLICY "select_own_rows" ON "PropertyCoordinator"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Property" p WHERE p.id = "propertyId" AND auth.uid()::text = p."ownerId"
  ));
