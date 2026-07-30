import type { ServiceCategory } from './service-category';

export type ServiceProviderType = ServiceCategory;

export interface ServiceProvider {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  type: ServiceProviderType;
  active: boolean;
  createdAt: string;
}
