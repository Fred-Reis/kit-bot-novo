-- Migration M3: ActivityLog schema refactor
-- Option B confirmed: delete existing rows (dev noise, not worth migrating)

DELETE FROM "ActivityLog";

-- Rename actor → actorLabel
ALTER TABLE "ActivityLog" RENAME COLUMN "actor" TO "actorLabel";

-- actorLabel: nullable → NOT NULL (table is empty, no UPDATE needed)
ALTER TABLE "ActivityLog" ALTER COLUMN "actorLabel" SET NOT NULL;

-- Add actorType NOT NULL (default 'system' during ADD, then drop default)
ALTER TABLE "ActivityLog" ADD COLUMN "actorType" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "ActivityLog" ALTER COLUMN "actorType" DROP DEFAULT;

-- Add actorId nullable
ALTER TABLE "ActivityLog" ADD COLUMN "actorId" TEXT;

-- subjectType: nullable → NOT NULL (empty table, safe)
ALTER TABLE "ActivityLog" ALTER COLUMN "subjectType" SET NOT NULL;

-- subjectId: nullable → NOT NULL (empty table, safe)
ALTER TABLE "ActivityLog" ALTER COLUMN "subjectId" SET NOT NULL;

-- Add metadata JSONB
ALTER TABLE "ActivityLog" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

-- Replace simple ownerId index (from M2) with composite indexes
DROP INDEX IF EXISTS "ActivityLog_ownerId_idx";
CREATE INDEX "ActivityLog_ownerId_createdAt_idx" ON "ActivityLog"("ownerId", "createdAt" DESC);
CREATE INDEX "ActivityLog_subjectType_subjectId_idx" ON "ActivityLog"("subjectType", "subjectId");
