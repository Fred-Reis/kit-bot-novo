-- Direct ownerId tables
CREATE POLICY "select_own_rows" ON "Property"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "PropertyMedia"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Lead"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "LeadDocument"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "LeadResident"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Tenant"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Payment"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "ActivityLog"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Event"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Conversation"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "RuleSet"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "ContractTemplate"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

CREATE POLICY "select_own_rows" ON "Contract"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

-- Join-based tables (no direct ownerId column)
CREATE POLICY "select_own_rows" ON "RuleSetPolicy"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "RuleSet" r WHERE r.id = "ruleSetId" AND auth.uid()::text = r."ownerId"
  ));

CREATE POLICY "select_own_rows" ON "PropertyRuleSet"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Property" p WHERE p.id = "propertyId" AND auth.uid()::text = p."ownerId"
  ));

-- Owner: self only
CREATE POLICY "select_self" ON "Owner"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = id);
