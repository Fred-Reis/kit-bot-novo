-- Remove duplicate (leadId, type) pairs keeping the most recent row
DELETE FROM "LeadDocument"
WHERE id NOT IN (
  SELECT DISTINCT ON ("leadId", "type") id
  FROM "LeadDocument"
  ORDER BY "leadId", "type", "createdAt" DESC
);

-- AddConstraint
ALTER TABLE "LeadDocument" ADD CONSTRAINT "LeadDocument_leadId_type_key" UNIQUE ("leadId", "type");
