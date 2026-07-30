export type MaintenanceType = 'eletrica' | 'hidraulica' | 'civil' | 'limpeza_conservacao';
export type MaintenanceResponsibility = 'tenant' | 'owner' | 'unclear';
export type MaintenanceSeverity = 'baixa' | 'media' | 'urgente';
export type MaintenanceStatus = 'open' | 'acknowledged' | 'in_progress' | 'resolved';

export interface MaintenanceRequest {
  id: string;
  ownerId: string;
  tenantId: string;
  propertyId: string;
  type: MaintenanceType;
  responsibility: MaintenanceResponsibility;
  severity: MaintenanceSeverity;
  summary: string;
  status: MaintenanceStatus;
  mediaUrls: string[];
  createdAt: string;
  updatedAt: string;
}
