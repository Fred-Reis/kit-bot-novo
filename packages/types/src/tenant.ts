export interface Tenant {
  id: string;
  externalId: string | null;
  phone: string;
  propertyId: string;
  propertyName: string | null;
  name: string | null;
  cpf: string | null;
  email: string | null;
  score: number | null;
  dueDay: number | null;
  onTimeRate: number | null;
  status: 'ok' | 'attention' | null;
  contractStart: string;
  contractEnd: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  tenantId: string;
  month: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue';
  description: string | null;
  type: 'income' | 'expense';
  paidAt: string | null;
  createdAt: string;
}
