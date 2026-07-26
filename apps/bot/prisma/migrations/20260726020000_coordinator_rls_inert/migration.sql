-- The previous migration (20260726010000_property_coordinator) enabled and
-- forced RLS on Coordinator/PropertyCoordinator, breaking the project-wide
-- convention that RLS policies are created but left inert until a separate,
-- explicit activation migration (see PR #29 / docs/adrs/001-rls-strategy.md).
-- This disables enforcement again; the policies themselves stay in place,
-- dormant, matching every other table (Property, RuleSet, PropertyRuleSet, ...).

ALTER TABLE "Coordinator" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "Coordinator" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "PropertyCoordinator" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "PropertyCoordinator" DISABLE ROW LEVEL SECURITY;
