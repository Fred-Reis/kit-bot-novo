export interface RuleSetPolicy {
  id: string;
  ruleSetId: string;
  name: string;
  description: string | null;
  value: 'yes' | 'no' | 'conditional';
  appliesToProperty: boolean;
}

export interface RuleSet {
  id: string;
  name: string;
  description: string | null;
  propagatePolicies: boolean;
  propagateClauses: boolean;
  propagateFields: boolean;
  createdAt: string;
}

export interface RuleSetSummary extends RuleSet {
  _count: { policies: number; properties: number };
}

export interface RuleSetDetail extends RuleSet {
  policies: RuleSetPolicy[];
  linkedPropertyIds: string[];
}
