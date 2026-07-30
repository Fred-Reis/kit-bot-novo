export type ServiceProviderType = 'eletrica' | 'hidraulica' | 'civil' | 'limpeza_conservacao';

export interface ServiceProvider {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  type: ServiceProviderType;
  active: boolean;
  createdAt: string;
}
