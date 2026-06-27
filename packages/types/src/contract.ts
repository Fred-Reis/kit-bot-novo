export type ContractStatus = 'active' | 'terminated' | 'renewal' | 'draft';

export interface Contract {
  id: string;
  ownerId: string;
  code: string;
  templateId: string;
  tenantId: string | null;
  leadId: string | null;
  propertyId: string;
  body: string;
  status: ContractStatus;
  pdfUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyRent: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractVariableSuggestion {
  field: string;
  label: string;
  value: string;
}

export interface ContractPreview {
  resolved: Record<string, string>;
  unresolved: string[];
  suggestions: ContractVariableSuggestion[];
}

export interface ContractDetail extends Contract {
  tenant: { name: string | null; phone: string };
  property: { name: string };
}

export interface ContractSummary {
  id: string;
  code: string;
  status: ContractStatus;
  startDate: string | null;
  endDate: string | null;
  monthlyRent: number;
  tenant: { name: string | null } | null;
  property: { name: string };
}
