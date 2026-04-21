export interface Tenant {
  id: string;
  phone: string;
  propertyId: string;
  name: string | null;
  cpf: string | null;
  email: string | null;
  score: number | null;
  dueDay: number | null;
  onTimeRate: number | null;
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
  paidAt: string | null;
  createdAt: string;
}
