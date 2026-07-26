export type CoordinatorResponsibility =
  | 'show_property'
  | 'deliver_keys'
  | 'receive_keys'
  | 'inspection';

export interface Coordinator {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  createdAt: string;
}

export interface CoordinatorSummary extends Coordinator {
  _count: { properties: number };
}

export interface LinkedPropertyWithResponsibilities {
  propertyId: string;
  externalId: string;
  responsibilities: CoordinatorResponsibility[];
}

export interface CoordinatorDetail extends Coordinator {
  linkedProperties: LinkedPropertyWithResponsibilities[];
}

export interface PropertyCoordinatorLink {
  responsibilities: CoordinatorResponsibility[];
  coordinator: Pick<Coordinator, 'id' | 'name' | 'phone'>;
}
