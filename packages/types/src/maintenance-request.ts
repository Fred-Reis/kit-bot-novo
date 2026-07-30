import type { ServiceCategory } from './service-category';

export type MaintenanceType = ServiceCategory;

export const MAINTENANCE_SEVERITIES = ['baixa', 'media', 'urgente'] as const;
export type MaintenanceSeverity = (typeof MAINTENANCE_SEVERITIES)[number];

export const MAINTENANCE_RESPONSIBILITIES = ['tenant', 'owner', 'unclear'] as const;
export type MaintenanceResponsibility = (typeof MAINTENANCE_RESPONSIBILITIES)[number];

export const MAINTENANCE_STATUSES = ['open', 'acknowledged', 'in_progress', 'resolved'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

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
