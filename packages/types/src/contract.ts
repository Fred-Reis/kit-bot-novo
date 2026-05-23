export interface Contract {
  id: string;
  ownerId: string;
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

export interface ContractDetail extends Contract {
  tenant: { name: string | null; phone: string };
  property: { name: string };
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
