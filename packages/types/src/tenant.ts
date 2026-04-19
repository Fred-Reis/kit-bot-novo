export interface Tenant {
  id: string;
  phone: string;
  propertyId: string;
  contractStart: string;
  contractEnd: string | null;
  createdAt: string;
}
