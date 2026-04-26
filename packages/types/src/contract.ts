export interface Contract {
  id: string;
  code: string;
  templateId: string;
  tenantId: string;
  propertyId: string;
  body: string;
  status: 'active' | 'terminated' | 'renewal';
  startDate: string;
  endDate: string | null;
  monthlyRent: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractSummary {
  id: string;
  code: string;
  status: 'active' | 'terminated' | 'renewal';
  startDate: string;
  endDate: string | null;
  monthlyRent: number;
  tenant: { name: string | null };
  property: { name: string };
}
